// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Outbound bridge control route. Browsers do not call this. The cloud does not dial printers.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { BridgeDirectory } from "../../shared/print-bridge-directory.js";
import { sha256Hex as hashText } from "../../shared/print-bridge-enrollment.js";
import { publicPrinterMessage } from "../../shared/printer-adapter.js";
import type { ProductionRepo } from "../../shared/production-jobs.js";

export interface PrintBridgeHttpDeps {
    directory: BridgeDirectory;
    repo: ProductionRepo;
    now?: () => Date;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
}

function bearer(req: IncomingMessage): string {
    const header = req.headers.authorization ?? "";
    return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export async function handlePrintBridgeNode(
    req: IncomingMessage,
    res: ServerResponse,
    deps: PrintBridgeHttpDeps,
): Promise<void> {
    const now = deps.now?.() ?? new Date();
    const path = (req.url ?? "").split("?")[0] ?? "";
    try {
        const body = req.method === "POST" ? await readJson(req) : {};
        if (req.method === "POST" && path === "/print-bridge/v1/enroll") {
            const proof = String(body.proof ?? "");
            const bridgeId = String(body.bridgeId ?? "");
            const origin = String(body.origin ?? "");
            const result = await deps.directory.redeem({ proof, bridgeId, origin, now });
            if (!result.ok) {
                send(res, 401, { error: "enrollment rejected" });
                return;
            }
            send(res, 201, { credential: result.credential });
            return;
        }
        const credential = bearer(req);
        const bridgeId = String(body.bridgeId ?? "");
        const bridge = await deps.directory.authenticate(credential, bridgeId);
        if (!bridge) {
            send(res, 401, { error: "bridge authentication failed" });
            return;
        }
        await deps.directory.touch(bridge.bridgeId, now.toISOString());
        if (path === "/print-bridge/v1/heartbeat") {
            const printers = [];
            for (const printer of await deps.repo.listPrinters()) {
                if (printer.bridgeId !== bridge.bridgeId || printer.tenantId !== bridge.tenantId) continue;
                const address = await deps.repo.getPrinterEndpoint(printer.id);
                if (!address) continue;
                printers.push({
                    id: printer.id,
                    address,
                    configVersion: printer.configVersion ?? 1,
                    enabled: printer.enabled !== false,
                    cancellation: printer.cancellation,
                });
            }
            const jobs = [];
            for (const job of await deps.repo.listJobs()) {
                if (job.bridgeId !== bridge.bridgeId || job.tenantId !== bridge.tenantId || !job.releasedAt)
                    continue;
                if (job.status === "done" || job.status === "cancelled" || job.status === "held") continue;
                if (!job.gcodeSha256 || !job.printerId) continue;
                const stored = await deps.repo.getGcode(job.id);
                if (!stored) continue;
                let action: "start" | "cancel" | "pause" | "resume" | "reconcile" = "reconcile";
                if (
                    job.controlRequest === "cancel" ||
                    job.controlRequest === "pause" ||
                    job.controlRequest === "resume"
                ) {
                    action = job.controlRequest;
                } else if ((job.dispatchState ?? "none") === "none") action = "start";
                jobs.push({
                    jobId: job.id,
                    printerId: job.printerId,
                    configVersion: job.configVersion ?? 1,
                    sha256: stored.sha256,
                    byteLength: Buffer.byteLength(stored.body),
                    filename: `orthocad-${job.id}.gcode`,
                    idempotencyKey: job.idempotencyKey ?? `${job.id}:${stored.sha256}:1`,
                    action,
                });
            }
            send(res, 200, { printers, jobs });
            return;
        }
        if (path === "/print-bridge/v1/artifact") {
            const job = await deps.repo.getJob(String(body.jobId ?? ""));
            if (!job || job.bridgeId !== bridge.bridgeId || job.tenantId !== bridge.tenantId) {
                send(res, 404, { error: "artifact not found" });
                return;
            }
            const stored = await deps.repo.getGcode(job.id);
            if (!stored || hashText(stored.body) !== stored.sha256) {
                send(res, 409, { error: "artifact rejected" });
                return;
            }
            send(res, 200, {
                sha256: stored.sha256,
                byteLength: Buffer.byteLength(stored.body),
                body: stored.body,
            });
            return;
        }
        if (path === "/print-bridge/v1/report") {
            const job = await deps.repo.getJob(String(body.jobId ?? ""));
            if (!job || job.bridgeId !== bridge.bridgeId) {
                send(res, 404, { error: "job not found" });
                return;
            }
            const kind = String(body.kind ?? "");
            const detail = publicPrinterMessage(String(body.detail ?? ""));
            const controllerJobId = typeof body.controllerJobId === "string" ? body.controllerJobId : null;
            if (kind === "uploaded") {
                await deps.repo.patchJob(job.id, {
                    dispatchState: "uploaded",
                    dispatchError: null,
                    updatedAt: now.toISOString(),
                });
            } else if (kind === "acknowledged") {
                await deps.repo.patchJob(job.id, {
                    dispatchState: "acknowledged",
                    status: "running",
                    controllerJobId,
                    progress: typeof body.progress === "number" ? body.progress : 0,
                    startedAt: job.startedAt ?? now.toISOString(),
                    dispatchError: null,
                    updatedAt: now.toISOString(),
                });
            } else if (kind === "uncertain" || kind === "blocked") {
                await deps.repo.patchJob(job.id, {
                    dispatchState: kind === "uncertain" ? "uncertain" : job.dispatchState,
                    dispatchError: detail,
                    updatedAt: now.toISOString(),
                });
            } else if (kind === "complete") {
                await deps.repo.patchJob(job.id, {
                    status: "done",
                    progress: 100,
                    finishedAt: now.toISOString(),
                    dispatchError: null,
                    updatedAt: now.toISOString(),
                });
            } else if (kind === "failed" || kind === "rejected") {
                await deps.repo.patchJob(job.id, {
                    status: "failed",
                    dispatchState: "rejected",
                    failureReason: detail,
                    dispatchError: detail,
                    updatedAt: now.toISOString(),
                });
            } else if (kind === "cancelled") {
                await deps.repo.patchJob(job.id, {
                    status: "cancelled",
                    finishedAt: now.toISOString(),
                    dispatchError: null,
                    updatedAt: now.toISOString(),
                });
            }
            send(res, 204, {});
            return;
        }
        send(res, 404, { error: "not found" });
    } catch {
        send(res, 400, { error: "bridge request rejected" });
    }
}
