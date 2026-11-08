// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Cloud-side Moonraker printer records and bridge release. The cloud does not dial printers.

import { type Actor, canAccessOrg } from "./client-files.js";
import type { BridgeCredential } from "./print-bridge-enrollment.js";
import { productionAddressPolicy } from "./printer-address-policy.js";
import {
    type PrinterRecord,
    ProductionError,
    type ProductionJob,
    type ProductionRepo,
} from "./production-jobs.js";

export const MOONRAKER_PROTOCOL_ID = "moonraker";
const STALE_MS = 30_000;

export interface SaveMoonrakerPrinterInput {
    id?: string;
    name: string;
    address: string;
    bridgeId: string;
    cancellation: "unsupported" | "explicit";
    enabled: boolean;
}

export function queuePhase(
    job: ProductionJob,
    printer: PrinterRecord | null,
    bridge: BridgeCredential | null,
    now = new Date(),
): "queued" | "offline" | "blocked" | "uncertain" | "uploaded" | "running" | "completed" | "cancelled" {
    if (job.status === "done") return "completed";
    if (job.status === "cancelled") return "cancelled";
    if (job.status === "held") return "blocked";
    if (job.dispatchState === "uncertain") return "uncertain";
    if (job.dispatchState === "uploaded") return "uploaded";
    if (job.status === "running" || job.status === "paused" || job.dispatchState === "acknowledged")
        return "running";
    if (!printer || printer.enabled === false || printer.adapterMode === "mock-only") return "blocked";
    if (!printer.bridgeId || !bridge || bridge.revokedAt) return "offline";
    if (!bridge.lastSeenAt || now.getTime() - new Date(bridge.lastSeenAt).getTime() > STALE_MS)
        return "offline";
    if (job.status === "assigned" || job.status === "waiting") return "queued";
    return "blocked";
}

export async function saveMoonrakerPrinter(
    repo: ProductionRepo,
    actor: Actor,
    input: SaveMoonrakerPrinterInput,
): Promise<PrinterRecord> {
    const name = input.name.trim();
    if (!name) throw new ProductionError("BAD_REQUEST", "Printer name is required");
    if (!input.bridgeId) throw new ProductionError("BAD_REQUEST", "A bridge is required.");
    const decision = productionAddressPolicy().decide(input.address);
    if (!decision.ok) throw new ProductionError("BAD_REQUEST", decision.reason);
    const normalized = new URL(input.address.trim());
    normalized.username = "";
    normalized.password = "";
    normalized.search = "";
    normalized.hash = "";
    const address = normalized.toString().replace(/\/$/, "");
    const existing = input.id
        ? (await repo.listPrinters()).find(
              (printer) => printer.id === input.id && canAccessOrg(actor, printer),
          )
        : null;
    if (input.id && !existing) throw new ProductionError("NOT_FOUND", "Printer not found");
    for (const printer of await repo.listPrinters()) {
        if (!canAccessOrg(actor, printer) || printer.id === existing?.id) continue;
        if ((await repo.getPrinterEndpoint(printer.id)) === address) {
            throw new ProductionError("BAD_REQUEST", "Another printer already uses that endpoint.");
        }
    }
    const inFlight = (await repo.listJobs()).filter(
        (job) =>
            job.printerId === existing?.id &&
            (job.dispatchState === "started" ||
                job.dispatchState === "uploaded" ||
                job.dispatchState === "acknowledged" ||
                job.dispatchState === "uncertain"),
    );
    const nextVersion = (existing?.configVersion ?? 0) + 1;
    if (existing && inFlight.length > 0 && (await repo.getPrinterEndpoint(existing.id)) !== address) {
        // Keep the in-flight snapshot. The new address is stored for later jobs only.
    }
    const printer: PrinterRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        state: existing?.state ?? "offline",
        tenantId: actor.tenantId,
        ownerId: existing?.ownerId ?? actor.id,
        adapterMode: "configured",
        protocolId: MOONRAKER_PROTOCOL_ID,
        endpointConfigured: true,
        credentialRef: null,
        cancellation: input.cancellation,
        liveVerified: false,
        protocolVerified: false,
        lastSeenAt: existing?.lastSeenAt ?? null,
        enabled: input.enabled,
        bridgeId: input.bridgeId,
        configVersion: nextVersion,
        address,
    };
    await repo.insertConfiguredPrinter(printer, {
        endpoint: address,
        protocolId: MOONRAKER_PROTOCOL_ID,
        credentialRef: "",
        cancellation: input.cancellation,
        lastSeenAt: existing?.lastSeenAt ?? null,
    });
    return printer;
}

export async function setMoonrakerPrinterEnabled(
    repo: ProductionRepo,
    actor: Actor,
    printerId: string,
    enabled: boolean,
): Promise<PrinterRecord> {
    const printer = (await repo.listPrinters()).find(
        (item) => item.id === printerId && canAccessOrg(actor, item),
    );
    if (!printer || printer.protocolId !== MOONRAKER_PROTOCOL_ID) {
        throw new ProductionError("NOT_FOUND", "Printer not found");
    }
    const address = await repo.getPrinterEndpoint(printer.id);
    if (!address) throw new ProductionError("BAD_REQUEST", "Printer endpoint is not configured.");
    const next = { ...printer, enabled, configVersion: (printer.configVersion ?? 0) + 1, address };
    await repo.insertConfiguredPrinter(next, {
        endpoint: address,
        protocolId: MOONRAKER_PROTOCOL_ID,
        credentialRef: printer.credentialRef ?? "",
        cancellation: printer.cancellation,
        lastSeenAt: printer.lastSeenAt,
    });
    return next;
}

export async function releaseAssignedJobToBridge(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    bridge: BridgeCredential | null,
    now = new Date(),
): Promise<ProductionJob> {
    const job = await repo.getJob(jobId);
    if (!job || !canAccessOrg(actor, job)) throw new ProductionError("NOT_FOUND", "Job not found");
    if (job.process !== "print")
        throw new ProductionError("BAD_REQUEST", "Mill jobs are not sent to a printer.");
    if (job.status === "held") throw new ProductionError("BAD_REQUEST", "A held job is not dispatched.");
    if (job.status !== "assigned") throw new ProductionError("BAD_REQUEST", "Assign the job before release.");
    if (job.dispatchState && job.dispatchState !== "none" && job.dispatchState !== "rejected") {
        throw new ProductionError("BAD_REQUEST", "This job is already in a dispatch attempt.");
    }
    const printer = (await repo.listPrinters()).find((item) => item.id === job.printerId);
    if (!printer || !canAccessOrg(actor, printer))
        throw new ProductionError("NOT_FOUND", "Printer not found");
    if (printer.adapterMode === "mock-only") {
        throw new ProductionError("BAD_REQUEST", "Mock printer registration is not a live controller.");
    }
    if (printer.protocolId !== MOONRAKER_PROTOCOL_ID || printer.enabled === false) {
        throw new ProductionError("BAD_REQUEST", "Printer is not an enabled Moonraker configuration.");
    }
    if (!printer.bridgeId || !bridge || bridge.bridgeId !== printer.bridgeId || bridge.revokedAt) {
        throw new ProductionError("BAD_REQUEST", "Bridge offline. The job was not sent.");
    }
    if (bridge.tenantId !== (actor.tenantId ?? bridge.tenantId)) {
        throw new ProductionError("NOT_FOUND", "Printer not found");
    }
    const seen = bridge.lastSeenAt ? new Date(bridge.lastSeenAt).getTime() : Number.NaN;
    if (!Number.isFinite(seen) || now.getTime() - seen > STALE_MS) {
        throw new ProductionError("BAD_REQUEST", "Bridge offline. The job was not sent.");
    }
    return repo.patchJob(job.id, {
        bridgeId: printer.bridgeId,
        configVersion: printer.configVersion ?? 1,
        releasedAt: now.toISOString(),
        dispatchState: "none",
        dispatchError: null,
        updatedAt: now.toISOString(),
    });
}
