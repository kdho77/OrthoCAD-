// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Bounded Moonraker client. Documented operations only:
// POST /server/files/upload (print=false), POST /printer/print/start,
// GET /printer/objects/query, JSON-RPC printer.objects.query,
// POST /printer/print/pause|resume|cancel.
// Does not call printer.gcode.script. Does not follow redirects.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { publicPrinterMessage } from "./printer-adapter.js";
import type { AddressPolicy } from "./printer-address-policy.js";

export const MOONRAKER_UPLOAD_PATH = "/server/files/upload";
export const MOONRAKER_START_PATH = "/printer/print/start";
export const MOONRAKER_QUERY_PATH = "/printer/objects/query";
export const MOONRAKER_CANCEL_PATH = "/printer/print/cancel";
export const MOONRAKER_PAUSE_PATH = "/printer/print/pause";
export const MOONRAKER_RESUME_PATH = "/printer/print/resume";
export const MOONRAKER_WS_PATH = "/websocket";

export class MoonrakerCallError extends Error {
    readonly mayHaveStarted: boolean;
    constructor(message: string, mayHaveStarted: boolean) {
        super(publicPrinterMessage(message));
        this.name = "MoonrakerCallError";
        this.mayHaveStarted = mayHaveStarted;
    }
}

export interface MoonrakerStatus {
    webhooksState: string;
    filename: string;
    printState: string;
    progress: number | null;
    message: string;
}

export interface MoonrakerClient {
    upload(input: {
        address: string;
        filename: string;
        body: Buffer;
        sha256: string;
        apiKey?: string;
    }): Promise<{
        path: string;
        size: number;
        printStarted: boolean;
    }>;
    start(input: { address: string; filename: string; apiKey?: string }): Promise<void>;
    queryHttp(input: { address: string; apiKey?: string }): Promise<MoonrakerStatus>;
    queryWebSocket(input: { address: string; apiKey?: string }): Promise<MoonrakerStatus>;
    cancel(input: { address: string; apiKey?: string }): Promise<void>;
    pause(input: { address: string; apiKey?: string }): Promise<void>;
    resume(input: { address: string; apiKey?: string }): Promise<void>;
}

function endpoint(
    policy: AddressPolicy,
    pins: Map<string, string>,
    address: string,
    path: string,
    query = "",
): Promise<URL> {
    return policy.resolve(address).then((decision) => {
        if (!decision.ok || !decision.pinnedIp) {
            throw new MoonrakerCallError(
                decision.ok ? "Printer address did not resolve." : decision.reason,
                false,
            );
        }
        const key = new URL(address.trim()).host;
        const previous = pins.get(key);
        if (previous && previous !== decision.pinnedIp) {
            throw new MoonrakerCallError(
                "Printer address resolution changed. The connection was not opened.",
                false,
            );
        }
        pins.set(key, decision.pinnedIp);
        const url = new URL(address.trim());
        url.hostname = decision.pinnedIp;
        url.pathname = path;
        url.search = query;
        url.hash = "";
        url.username = "";
        url.password = "";
        return url;
    });
}

function call(
    url: URL,
    init: { method: string; headers: Record<string, string>; body?: Buffer; mayHaveStarted: boolean },
): Promise<{ status: number; body: string }> {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
        const req = transport(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port,
                path: `${url.pathname}${url.search}`,
                method: init.method,
                headers: init.headers,
                timeout: 8_000,
            },
            (res) => {
                const status = res.statusCode ?? 0;
                if (status >= 300 && status < 400) {
                    res.resume();
                    reject(new MoonrakerCallError("Moonraker redirect was rejected.", init.mayHaveStarted));
                    return;
                }
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
                res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
            },
        );
        let sent = false;
        req.on("timeout", () => {
            req.destroy(new MoonrakerCallError("Moonraker request timed out.", sent && init.mayHaveStarted));
        });
        req.on("error", (error) => {
            if (error instanceof MoonrakerCallError) reject(error);
            else reject(new MoonrakerCallError(error.message, sent && init.mayHaveStarted));
        });
        if (init.body) req.write(init.body);
        sent = true;
        req.end();
    });
}

function headers(apiKey: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
    const out = { ...extra };
    if (apiKey) out["X-Api-Key"] = apiKey;
    return out;
}

function multipart(filename: string, body: Buffer, sha256: string): { payload: Buffer; contentType: string } {
    const boundary = `orthocad${sha256.slice(0, 12)}`;
    const preamble = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="root"\r\n\r\ngcodes\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="print"\r\n\r\nfalse\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="checksum"\r\n\r\n${sha256}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: application/octet-stream\r\n\r\n`,
    );
    const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
        payload: Buffer.concat([preamble, body, ending]),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

/**
 * Shop presence from one Moonraker objects query.
 * idle = reachable and not printing (shown as Online). running = printing.
 * Callers that cannot reach the printer report offline without using this.
 */
export function printerStateFromMoonraker(
    status: Pick<MoonrakerStatus, "webhooksState" | "printState">,
): "idle" | "running" | "paused" | "error" | "offline" {
    const webhooks = status.webhooksState.trim().toLowerCase();
    const print = status.printState.trim().toLowerCase();
    if (webhooks === "shutdown" || webhooks === "disconnected") return "offline";
    if (webhooks === "error" || print === "error") return "error";
    if (print === "printing") return "running";
    if (print === "paused") return "paused";
    if (webhooks === "ready" || webhooks === "startup") {
        if (
            print === "standby" ||
            print === "complete" ||
            print === "cancelled" ||
            print === "canceled" ||
            print === ""
        ) {
            return "idle";
        }
    }
    return "offline";
}

function parseStatus(raw: string): MoonrakerStatus {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new MoonrakerCallError("Moonraker status was malformed.", false);
    }
    const status = (parsed as { result?: { status?: Record<string, unknown> } }).result?.status;
    if (!status) throw new MoonrakerCallError("Moonraker status was malformed.", false);
    const webhooks = status.webhooks as { state?: string; message?: string } | undefined;
    const printStats = status.print_stats as
        | { filename?: string; state?: string; message?: string }
        | undefined;
    const virtualSd = status.virtual_sdcard as { progress?: number } | undefined;
    if (!webhooks?.state || !printStats?.state)
        throw new MoonrakerCallError("Moonraker status was incomplete.", false);
    const progress = typeof virtualSd?.progress === "number" ? Math.round(virtualSd.progress * 100) : null;
    return {
        webhooksState: webhooks.state,
        filename: printStats.filename ?? "",
        printState: printStats.state,
        progress,
        message: publicPrinterMessage(printStats.message || webhooks.message || ""),
    };
}

async function expectOk(response: { status: number; body: string }, mayHaveStarted: boolean): Promise<void> {
    if (response.status === 401 || response.status === 403) {
        throw new MoonrakerCallError("Moonraker authentication was denied.", false);
    }
    if (response.status < 200 || response.status >= 300) {
        throw new MoonrakerCallError("Moonraker rejected the request.", mayHaveStarted);
    }
}

export function createMoonrakerClient(policy: AddressPolicy): MoonrakerClient {
    const pins = new Map<string, string>();
    return {
        async upload({ address, filename, body, sha256, apiKey }) {
            if (!/^orthocad-[0-9a-f-]{36}\.gcode$/i.test(filename)) {
                throw new MoonrakerCallError("Upload filename is not an OrthoCAD job name.", false);
            }
            const url = await endpoint(policy, pins, address, MOONRAKER_UPLOAD_PATH);
            const form = multipart(filename, body, sha256);
            const response = await call(url, {
                method: "POST",
                headers: headers(apiKey, {
                    "content-type": form.contentType,
                    "content-length": String(form.payload.length),
                }),
                body: form.payload,
                mayHaveStarted: true,
            });
            await expectOk(response, true);
            let parsed: { item?: { path?: string; size?: number }; print_started?: boolean };
            try {
                parsed = JSON.parse(response.body);
            } catch {
                throw new MoonrakerCallError("Moonraker upload response was malformed.", true);
            }
            if (!parsed.item?.path || parsed.item.size !== body.length) {
                throw new MoonrakerCallError("Moonraker upload did not match the artifact.", true);
            }
            return {
                path: parsed.item.path,
                size: parsed.item.size,
                printStarted: parsed.print_started === true,
            };
        },
        async start({ address, filename, apiKey }) {
            const url = await endpoint(
                policy,
                pins,
                address,
                MOONRAKER_START_PATH,
                `?filename=${encodeURIComponent(filename)}`,
            );
            const response = await call(url, {
                method: "POST",
                headers: headers(apiKey),
                mayHaveStarted: true,
            });
            await expectOk(response, true);
            if (response.body.trim() !== "ok" && !response.body.includes("ok")) {
                throw new MoonrakerCallError("Moonraker start was not acknowledged.", true);
            }
        },
        async queryHttp({ address, apiKey }) {
            const url = await endpoint(
                policy,
                pins,
                address,
                MOONRAKER_QUERY_PATH,
                "?webhooks&virtual_sdcard&print_stats",
            );
            const response = await call(url, {
                method: "GET",
                headers: headers(apiKey),
                mayHaveStarted: false,
            });
            await expectOk(response, false);
            return parseStatus(response.body);
        },
        async queryWebSocket({ address, apiKey }) {
            const url = await endpoint(policy, pins, address, MOONRAKER_WS_PATH);
            const wsUrl = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}${MOONRAKER_WS_PATH}`;
            const Factory = (
                globalThis as {
                    WebSocket?: new (
                        url: string,
                        protocols?: string | string[],
                    ) => {
                        close(): void;
                        send(data: string): void;
                        addEventListener(type: string, cb: (event: { data?: unknown }) => void): void;
                    };
                }
            ).WebSocket;
            if (!Factory)
                throw new MoonrakerCallError("Moonraker websocket is not available in this runtime.", false);
            if (apiKey) {
                throw new MoonrakerCallError(
                    "Moonraker websocket status does not accept a key on the URL. Use the HTTP status query.",
                    false,
                );
            }
            const socket = new Factory(wsUrl);
            const payload = JSON.stringify({
                jsonrpc: "2.0",
                method: "printer.objects.query",
                params: { objects: { webhooks: null, print_stats: null, virtual_sdcard: null } },
                id: 1,
            });
            const raw = await new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => {
                    socket.close();
                    reject(new MoonrakerCallError("Moonraker websocket timed out.", false));
                }, 1_000);
                socket.addEventListener("error", () => {
                    clearTimeout(timer);
                    reject(new MoonrakerCallError("Moonraker websocket failed.", false));
                });
                socket.addEventListener("open", () => socket.send(payload));
                socket.addEventListener("message", (event) => {
                    clearTimeout(timer);
                    resolve(String(event.data));
                    socket.close();
                });
            });
            return parseStatus(raw);
        },
        async cancel(input) {
            const url = await endpoint(policy, pins, input.address, MOONRAKER_CANCEL_PATH);
            const response = await call(url, {
                method: "POST",
                headers: headers(input.apiKey),
                mayHaveStarted: false,
            });
            await expectOk(response, false);
        },
        async pause(input) {
            const url = await endpoint(policy, pins, input.address, MOONRAKER_PAUSE_PATH);
            const response = await call(url, {
                method: "POST",
                headers: headers(input.apiKey),
                mayHaveStarted: false,
            });
            await expectOk(response, false);
        },
        async resume(input) {
            const url = await endpoint(policy, pins, input.address, MOONRAKER_RESUME_PATH);
            const response = await call(url, {
                method: "POST",
                headers: headers(input.apiKey),
                mayHaveStarted: false,
            });
            await expectOk(response, false);
        },
    };
}
