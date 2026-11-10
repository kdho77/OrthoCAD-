// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Outbound bridge control route. Browsers do not call this. The cloud does not dial printers.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { BridgeDirectory } from "../../shared/print-bridge-directory.js";
import { type BridgeCredential, sha256Hex as hashText } from "../../shared/print-bridge-enrollment.js";
import type { DiscoveryCandidateRecord } from "../../shared/print-bridge-pairing.js";
import { publicPrinterMessage } from "../../shared/printer-adapter.js";
import {
    PRINTER_STATES,
    type PrinterRecord,
    type PrinterState,
    type ProductionRepo,
} from "../../shared/production-jobs.js";

/**
 * Raw G-code bytes per artifact response.
 * Vercel serverless responses are limited to about 4.5 MB. A realistic insole
 * G-code can exceed that (the queue accepts up to 5_000_000 characters, and
 * JSON encoding expands newlines). 1 MiB stays under the limit even if every
 * byte were escaped. The bridge reassembles the ranges and checks sha256.
 */
export const ARTIFACT_CHUNK_BYTES = 1024 * 1024;

export interface PrintBridgeHttpDeps {
    directory: BridgeDirectory;
    repo: ProductionRepo;
    now?: () => Date;
    /** Test override. Production never exceeds ARTIFACT_CHUNK_BYTES. */
    artifactChunkBytes?: number;
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

function artifactOffset(value: unknown): number | null {
    if (value === undefined) return 0;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
    return value;
}

function sliceArtifact(
    body: string,
    offset: number,
    chunkBytes: number,
): { slice: string; complete: boolean } | null {
    const bytes = Buffer.from(body, "utf8");
    if (offset > bytes.length) return null;
    const end = Math.min(bytes.length, offset + chunkBytes);
    let sliceEnd = end;
    while (sliceEnd > offset && sliceEnd < bytes.length) {
        const byte = bytes[sliceEnd];
        if (byte === undefined || (byte & 0xc0) !== 0x80) break;
        sliceEnd -= 1;
    }
    return {
        slice: bytes.subarray(offset, sliceEnd).toString("utf8"),
        complete: sliceEnd >= bytes.length,
    };
}

const BRIDGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readDiscoveryCandidates(value: unknown): DiscoveryCandidateRecord[] {
    if (!Array.isArray(value)) return [];
    const candidates: DiscoveryCandidateRecord[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const host = "host" in item && typeof item.host === "string" ? item.host : "";
        const port = "port" in item && typeof item.port === "number" ? item.port : 0;
        const address = "address" in item && typeof item.address === "string" ? item.address : "";
        const source =
            "source" in item && (item.source === "mdns" || item.source === "scan") ? item.source : null;
        if (!host || !source || !Number.isInteger(port)) continue;
        const info = "info" in item && item.info && typeof item.info === "object" ? item.info : null;
        const text = (key: string): string | null => {
            if (!info || !(key in info)) return null;
            const field = (info as Record<string, unknown>)[key];
            return typeof field === "string" && field.length > 0 && field.length <= 120 ? field : null;
        };
        candidates.push({
            host,
            port,
            address,
            source,
            info: info
                ? {
                      hostname: text("hostname"),
                      moonrakerVersion: text("moonrakerVersion"),
                      klippyState: text("klippyState"),
                      apiVersion: text("apiVersion"),
                  }
                : null,
        });
    }
    return candidates;
}

function readConnectionTest(
    value: unknown,
): { address: string; info: DiscoveryCandidateRecord["info"] } | null {
    if (!value || typeof value !== "object") return null;
    const address = "address" in value && typeof value.address === "string" ? value.address : "";
    if (!address) return null;
    const info = "info" in value && value.info && typeof value.info === "object" ? value.info : null;
    const text = (key: string): string | null => {
        if (!info || !(key in info)) return null;
        const field = (info as Record<string, unknown>)[key];
        return typeof field === "string" && field.length > 0 && field.length <= 120 ? field : null;
    };
    return {
        address,
        info: info
            ? {
                  hostname: text("hostname"),
                  moonrakerVersion: text("moonrakerVersion"),
                  klippyState: text("klippyState"),
                  apiVersion: text("apiVersion"),
              }
            : null,
    };
}

function isPrinterState(value: string): value is PrinterState {
    return (PRINTER_STATES as readonly string[]).includes(value);
}

/**
 * Optional printer presence on heartbeat. A body that omits `printers` (the
 * installed desktop relay posts `{bridgeId}` only) does not change printer
 * state. Listed rows update shop_printers.state and shop_printer_configs.lastSeenAt.
 * Unlisted printers are left as they are, including when they were online.
 */
async function applyBridgePrinterPresence(
    repo: ProductionRepo,
    known: PrinterRecord[],
    bridge: BridgeCredential,
    reported: unknown,
    at: string,
): Promise<void> {
    if (!Array.isArray(reported)) return;
    for (const entry of reported) {
        if (!entry || typeof entry !== "object") continue;
        const id = "id" in entry && typeof entry.id === "string" ? entry.id : "";
        const state = "state" in entry && typeof entry.state === "string" ? entry.state : "";
        if (!id || !isPrinterState(state)) continue;
        const printer = known.find(
            (item) =>
                item.id === id && item.bridgeId === bridge.bridgeId && item.tenantId === bridge.tenantId,
        );
        if (!printer) continue;
        await repo.patchPrinter(printer.id, { state, lastSeenAt: at });
    }
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
        if (req.method === "POST" && path === "/print-bridge/v1/pair/begin") {
            const bridgeId = String(body.bridgeId ?? "");
            const deviceProof = String(body.deviceProof ?? "");
            const origin = String(body.origin ?? "");
            if (!BRIDGE_ID.test(bridgeId)) {
                send(res, 400, { error: "pairing rejected" });
                return;
            }
            const result = await deps.directory.beginPairing({ bridgeId, deviceProof, origin, now });
            if (!result.ok) {
                send(res, result.reason === "already-enrolled" ? 409 : 400, {
                    error: "pairing rejected",
                    reason: result.reason,
                });
                return;
            }
            send(res, 201, { pairingCode: result.pairingCode, expiresAt: result.expiresAt });
            return;
        }
        if (req.method === "POST" && path === "/print-bridge/v1/pair/poll") {
            const bridgeId = String(body.bridgeId ?? "");
            const deviceProof = String(body.deviceProof ?? "");
            const origin = String(body.origin ?? "");
            const result = await deps.directory.pollPairing({ bridgeId, deviceProof, origin, now });
            if (result.status === "rejected") {
                send(res, 401, { error: "pairing rejected" });
                return;
            }
            if (result.status === "ready") {
                send(res, 200, {
                    status: "ready",
                    credential: result.credential,
                    bridgeId: result.bridgeId,
                });
                return;
            }
            send(res, 200, { status: result.status });
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
            const known = await deps.repo.listPrinters();
            await applyBridgePrinterPresence(deps.repo, known, bridge, body.printers, now.toISOString());
            const printers = [];
            for (const printer of known) {
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
            const payload: {
                printers: typeof printers;
                jobs: typeof jobs;
                discoveryProbe?: { address: string };
            } = { printers, jobs };
            const probe = await deps.directory.pendingDiscoveryProbe(bridge.bridgeId);
            if (probe) payload.discoveryProbe = probe;
            send(res, 200, payload);
            return;
        }
        if (path === "/print-bridge/v1/discovery") {
            const candidates = readDiscoveryCandidates(body.candidates);
            const connectionTest = readConnectionTest(body.connectionTest);
            await deps.directory.reportDiscovery({
                bridge,
                candidates,
                connectionTest,
                now,
            });
            send(res, 204, {});
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
            const offset = artifactOffset(body.offset);
            if (offset === null) {
                send(res, 400, { error: "bridge request rejected" });
                return;
            }
            const chunkBytes = Math.min(
                ARTIFACT_CHUNK_BYTES,
                Math.max(1, deps.artifactChunkBytes ?? ARTIFACT_CHUNK_BYTES),
            );
            const slice = sliceArtifact(stored.body, offset, chunkBytes);
            if (!slice) {
                send(res, 400, { error: "bridge request rejected" });
                return;
            }
            send(res, 200, {
                sha256: stored.sha256,
                byteLength: Buffer.byteLength(stored.body),
                offset,
                body: slice.slice,
                complete: slice.complete,
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
