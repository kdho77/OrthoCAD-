// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Always-on bridge loop. It dials the configured cloud origin and then Moonraker.
// It does not open a listen port.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { createMoonrakerClient, MoonrakerCallError, type MoonrakerClient } from "./moonraker-client.js";
import { sha256Hex } from "./print-bridge-enrollment.js";
import { publicPrinterMessage } from "./printer-adapter.js";
import type { AddressPolicy } from "./printer-address-policy.js";
import { productionBridgePolicy } from "./printer-address-resolve.js";

export interface BridgeJobOffer {
    jobId: string;
    printerId: string;
    configVersion: number;
    sha256: string;
    byteLength: number;
    filename: string;
    idempotencyKey: string;
    action: "start" | "cancel" | "pause" | "resume" | "reconcile";
}

export interface BridgePrinterOffer {
    id: string;
    address: string;
    configVersion: number;
    enabled: boolean;
    cancellation: "unsupported" | "explicit";
}

interface Lease {
    jobId: string;
    idempotencyKey: string;
    phase: "uploaded" | "start-sent" | "acknowledged" | "uncertain";
    filename: string;
    configVersion: number;
}

export interface BridgeSessionOptions {
    origin: string;
    bridgeId: string;
    stateDir: string;
    policy?: AddressPolicy;
    proof?: string;
    credential?: string;
    moonraker?: MoonrakerClient;
    maxCycles?: number;
    signal?: AbortSignal;
}

function leasePath(dir: string, jobId: string): string {
    return join(dir, `job-${jobId}.json`);
}

function readLease(dir: string, jobId: string): Lease | null {
    try {
        return JSON.parse(readFileSync(leasePath(dir, jobId), "utf8")) as Lease;
    } catch {
        return null;
    }
}

function writeLease(dir: string, lease: Lease): void {
    writeFileSync(leasePath(dir, lease.jobId), JSON.stringify(lease), { mode: 0o600 });
}

function cloud(
    origin: string,
    path: string,
    body: unknown,
    credential: string | null,
): Promise<{ status: number; json: Record<string, unknown> }> {
    const url = new URL(path, origin.endsWith("/") ? origin : `${origin}/`);
    if (url.origin !== new URL(origin).origin) {
        return Promise.reject(
            new Error("Bridge refused a cloud destination that is not the configured origin."),
        );
    }
    const payload = Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = {
        "content-type": "application/json",
        "content-length": String(payload.length),
    };
    if (credential) headers.authorization = `Bearer ${credential}`;
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
        const req = transport(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port,
                path: `${url.pathname}${url.search}`,
                method: "POST",
                headers,
            },
            (res) => {
                const status = res.statusCode ?? 0;
                if (status >= 300 && status < 400) {
                    res.resume();
                    reject(new Error("Cloud redirect was rejected."));
                    return;
                }
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    let json: Record<string, unknown> = {};
                    if (text) {
                        try {
                            json = JSON.parse(text) as Record<string, unknown>;
                        } catch {
                            json = {};
                        }
                    }
                    resolve({ status, json });
                });
            },
        );
        req.on("error", reject);
        req.end(payload);
    });
}

function filenameFor(jobId: string): string {
    return `orthocad-${jobId}.gcode`;
}

export async function runBridgeSession(
    options: BridgeSessionOptions,
): Promise<{ cycles: number; stopped: string }> {
    const origin = options.origin;
    const policy = options.policy ?? productionBridgePolicy();
    const moonraker = options.moonraker ?? createMoonrakerClient(policy);
    mkdirSync(options.stateDir, { recursive: true });
    const credentialFile = join(options.stateDir, "credential");
    let credential = options.credential ?? null;
    if (!credential) {
        try {
            credential = readFileSync(credentialFile, "utf8").trim() || null;
        } catch {
            credential = null;
        }
    }
    if (!credential) {
        if (!options.proof) return { cycles: 0, stopped: "enrollment-required" };
        const enrolled = await cloud(
            origin,
            "/print-bridge/v1/enroll",
            { proof: options.proof, bridgeId: options.bridgeId, origin },
            null,
        );
        if (enrolled.status !== 201 || typeof enrolled.json.credential !== "string") {
            return { cycles: 0, stopped: "enrollment-rejected" };
        }
        credential = enrolled.json.credential;
        writeFileSync(credentialFile, credential, { mode: 0o600 });
    }
    let backoff = 200;
    let cycles = 0;
    const limit = options.maxCycles ?? 1;
    while (cycles < limit && !options.signal?.aborted) {
        cycles += 1;
        const beat = await cloud(
            origin,
            "/print-bridge/v1/heartbeat",
            { bridgeId: options.bridgeId },
            credential,
        );
        if (beat.status === 401) {
            rmSync(credentialFile, { force: true });
            return { cycles, stopped: "revoked" };
        }
        if (beat.status !== 200) {
            await new Promise((resolve) => setTimeout(resolve, backoff));
            backoff = Math.min(backoff * 2, 30_000);
            continue;
        }
        backoff = 200;
        const printers = (beat.json.printers ?? []) as BridgePrinterOffer[];
        const jobs = (beat.json.jobs ?? []) as BridgeJobOffer[];
        for (const job of jobs) {
            const printer = printers.find((item) => item.id === job.printerId);
            if (!printer || !printer.enabled || printer.configVersion !== job.configVersion) {
                await cloud(
                    origin,
                    "/print-bridge/v1/report",
                    {
                        bridgeId: options.bridgeId,
                        jobId: job.jobId,
                        kind: "blocked",
                        detail: "Printer configuration changed or is disabled.",
                    },
                    credential,
                );
                continue;
            }
            const decision = await policy.resolve(printer.address);
            if (!decision.ok) {
                await cloud(
                    origin,
                    "/print-bridge/v1/report",
                    {
                        bridgeId: options.bridgeId,
                        jobId: job.jobId,
                        kind: "blocked",
                        detail: decision.reason,
                    },
                    credential,
                );
                continue;
            }
            const lease = readLease(options.stateDir, job.jobId);
            if (lease?.phase === "uncertain" || lease?.phase === "start-sent" || job.action === "reconcile") {
                await reconcile(
                    moonraker,
                    printer.address,
                    lease?.filename ?? filenameFor(job.jobId),
                    job,
                    options,
                    credential,
                );
                continue;
            }
            if (job.action === "cancel" || job.action === "pause" || job.action === "resume") {
                if (printer.cancellation !== "explicit" && job.action === "cancel") {
                    await report(
                        origin,
                        credential,
                        options.bridgeId,
                        job.jobId,
                        "blocked",
                        "Cancellation is not enabled for this printer.",
                    );
                    continue;
                }
                try {
                    if (job.action === "cancel") await moonraker.cancel({ address: printer.address });
                    if (job.action === "pause") await moonraker.pause({ address: printer.address });
                    if (job.action === "resume") await moonraker.resume({ address: printer.address });
                    await report(
                        origin,
                        credential,
                        options.bridgeId,
                        job.jobId,
                        job.action === "cancel" ? "cancelled" : "acknowledged",
                        "Controller accepted the operator control.",
                    );
                } catch (error) {
                    await report(
                        origin,
                        credential,
                        options.bridgeId,
                        job.jobId,
                        "blocked",
                        error instanceof Error ? error.message : "Control failed.",
                    );
                }
                continue;
            }
            if (lease?.phase === "acknowledged") continue;
            const artifact = await cloud(
                origin,
                "/print-bridge/v1/artifact",
                { bridgeId: options.bridgeId, jobId: job.jobId },
                credential,
            );
            const body = typeof artifact.json.body === "string" ? artifact.json.body : "";
            const actual = sha256Hex(body);
            if (
                artifact.status !== 200 ||
                actual !== job.sha256 ||
                Buffer.byteLength(body) !== job.byteLength
            ) {
                await report(
                    origin,
                    credential,
                    options.bridgeId,
                    job.jobId,
                    "rejected",
                    "Artifact hash or size did not match.",
                );
                continue;
            }
            const filename = filenameFor(job.jobId);
            try {
                const uploaded = await moonraker.upload({
                    address: printer.address,
                    filename,
                    body: Buffer.from(body),
                    sha256: actual,
                });
                writeLease(options.stateDir, {
                    jobId: job.jobId,
                    idempotencyKey: job.idempotencyKey,
                    phase: uploaded.printStarted ? "uncertain" : "uploaded",
                    filename: uploaded.path,
                    configVersion: job.configVersion,
                });
                await report(
                    origin,
                    credential,
                    options.bridgeId,
                    job.jobId,
                    uploaded.printStarted ? "uncertain" : "uploaded",
                    "Upload finished.",
                );
                if (uploaded.printStarted) continue;
                await moonraker.start({ address: printer.address, filename: uploaded.path });
                writeLease(options.stateDir, {
                    jobId: job.jobId,
                    idempotencyKey: job.idempotencyKey,
                    phase: "start-sent",
                    filename: uploaded.path,
                    configVersion: job.configVersion,
                });
                await reconcile(moonraker, printer.address, uploaded.path, job, options, credential);
            } catch (error) {
                const uncertain = error instanceof MoonrakerCallError && error.mayHaveStarted;
                writeLease(options.stateDir, {
                    jobId: job.jobId,
                    idempotencyKey: job.idempotencyKey,
                    phase: uncertain ? "uncertain" : "uploaded",
                    filename,
                    configVersion: job.configVersion,
                });
                await report(
                    origin,
                    credential,
                    options.bridgeId,
                    job.jobId,
                    uncertain ? "uncertain" : "rejected",
                    publicPrinterMessage(
                        error instanceof Error ? error.message : "Moonraker request failed.",
                    ),
                );
            }
        }
    }
    return { cycles, stopped: "cycles" };
}

async function report(
    origin: string,
    credential: string,
    bridgeId: string,
    jobId: string,
    kind: string,
    detail: string,
): Promise<void> {
    await cloud(
        origin,
        "/print-bridge/v1/report",
        { bridgeId, jobId, kind, detail: publicPrinterMessage(detail) },
        credential,
    );
}

async function reconcile(
    moonraker: MoonrakerClient,
    address: string,
    filename: string,
    job: BridgeJobOffer,
    options: BridgeSessionOptions,
    credential: string,
): Promise<void> {
    try {
        const status = await moonraker.queryHttp({ address });
        let socketStatus = status;
        try {
            socketStatus = await moonraker.queryWebSocket({ address });
        } catch {
            socketStatus = status;
        }
        const seen = socketStatus.filename ? socketStatus : status;
        if (seen.filename && seen.filename !== filename) {
            writeLease(options.stateDir, {
                jobId: job.jobId,
                idempotencyKey: job.idempotencyKey,
                phase: "uncertain",
                filename,
                configVersion: job.configVersion,
            });
            await report(
                options.origin,
                credential,
                options.bridgeId,
                job.jobId,
                "uncertain",
                "Controller filename did not match. The job was not sent again.",
            );
            return;
        }
        if (seen.printState === "printing" || seen.printState === "paused") {
            writeLease(options.stateDir, {
                jobId: job.jobId,
                idempotencyKey: job.idempotencyKey,
                phase: "acknowledged",
                filename,
                configVersion: job.configVersion,
            });
            await cloud(
                options.origin,
                "/print-bridge/v1/report",
                {
                    bridgeId: options.bridgeId,
                    jobId: job.jobId,
                    kind: "acknowledged",
                    controllerJobId: filename,
                    progress: seen.progress,
                    detail: "Controller is printing the stored filename.",
                },
                credential,
            );
            return;
        }
        if (seen.printState === "complete") {
            await report(
                options.origin,
                credential,
                options.bridgeId,
                job.jobId,
                "complete",
                "Controller reported complete.",
            );
            return;
        }
        if (seen.printState === "error" || seen.printState === "cancelled") {
            await report(
                options.origin,
                credential,
                options.bridgeId,
                job.jobId,
                seen.printState === "cancelled" ? "cancelled" : "failed",
                seen.message || "Controller reported a terminal state.",
            );
            return;
        }
        writeLease(options.stateDir, {
            jobId: job.jobId,
            idempotencyKey: job.idempotencyKey,
            phase: "uncertain",
            filename,
            configVersion: job.configVersion,
        });
        await report(
            options.origin,
            credential,
            options.bridgeId,
            job.jobId,
            "uncertain",
            "Controller is idle after a possible start. The job was not sent again.",
        );
    } catch (error) {
        await report(
            options.origin,
            credential,
            options.bridgeId,
            job.jobId,
            "uncertain",
            error instanceof Error ? error.message : "Status check failed.",
        );
    }
}
