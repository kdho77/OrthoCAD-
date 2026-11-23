// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Loads the Mill CNC job in this process. The browser Export path is the same bundle.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SAMPLE_TOP_URL = new URL("../../../public/Templates/SAMPLE_Top.glb", import.meta.url);

export interface HeadlessMillGcode {
    gcode: string;
    sides: Array<"left" | "right">;
    fileExtension: string;
}

interface MillDesign {
    method?: string;
}

interface MillJobModule {
    PRINT_ORDER_CNC_REFUSAL: string;
    assertMilledCncOrder(design: MillDesign): void;
    designStateFromDocument(doc: unknown): MillDesign;
    millExportSides(
        design: unknown,
        requested?: unknown,
        millSide?: "LR" | "RR" | "LL",
    ): Array<"left" | "right">;
    buildMillCncGcode(input: { design: unknown; millSide?: "LR" | "RR" | "LL" }): Promise<HeadlessMillGcode>;
}

let millModule: MillJobModule | null = null;
let sampleTopBytes: Uint8Array | null = null;
let fetchInstalled = false;

/**
 * FileLoader builds `new Request("/Templates/SAMPLE_Top.glb")`.
 * Node rejects a path without a base. Give those loads a local base before fetch.
 */
function installRelativeRequestBase(): void {
    const marker = globalThis as { __ocadSampleTopRequest?: boolean };
    if (marker.__ocadSampleTopRequest) return;
    marker.__ocadSampleTopRequest = true;
    const OriginalRequest = globalThis.Request;
    const PatchedRequest = function PatchedRequest(input: string | URL, init?: RequestInit) {
        if (typeof input === "string" && input.startsWith("/")) {
            return new OriginalRequest(`http://127.0.0.1${input}`, init);
        }
        return new OriginalRequest(input, init);
    } as unknown as typeof Request;
    PatchedRequest.prototype = OriginalRequest.prototype;
    globalThis.Request = PatchedRequest;
}

function requestUrl(input: string | URL | { url: string }): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

/**
 * GLTFLoader fetches `/Templates/SAMPLE_Top.glb`. Node has no public file server.
 * Serve the bundled bytes for that URL so loadBaseGeometry stays the browser path.
 */
export function installBundledSampleTopFetch(bytes: Uint8Array): void {
    sampleTopBytes = bytes;
    installRelativeRequestBase();
    if (fetchInstalled) return;
    fetchInstalled = true;
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: string | URL | { url: string }, init?: RequestInit) => {
        const url = requestUrl(input);
        if (sampleTopBytes && /SAMPLE_Top\.glb(?:$|[?#])/i.test(url)) {
            const copy = new Uint8Array(sampleTopBytes.byteLength);
            copy.set(sampleTopBytes);
            return new Response(copy, {
                status: 200,
                headers: { "content-type": "model/gltf-binary" },
            });
        }
        return original(input as Parameters<typeof original>[0], init);
    }) as typeof globalThis.fetch;
}

async function ensureBrowserParser(): Promise<void> {
    const target = globalThis as unknown as {
        DOMParser?: unknown;
        ProgressEvent?: unknown;
        self?: unknown;
    };
    if (typeof target.DOMParser === "function" && typeof target.ProgressEvent === "function") return;
    const { Window } = await import("happy-dom");
    const window = new Window();
    if (typeof target.DOMParser !== "function") target.DOMParser = window.DOMParser;
    if (typeof target.ProgressEvent !== "function") target.ProgressEvent = window.ProgressEvent;
    if (!target.self) target.self = globalThis;
}

async function loadMillModule(): Promise<MillJobModule> {
    if (millModule) return millModule;
    await ensureBrowserParser();
    // Literal specifier so the Vercel file trace copies the bundle into the function.
    // Emitted by vertex/scripts/bundle-cnc-mill-job.mjs. Do not import the .ts path.
    millModule = (await import("./cnc-mill-job.js")) as MillJobModule;
    return millModule;
}

async function bundledSampleTop(): Promise<Uint8Array> {
    if (sampleTopBytes) return sampleTopBytes;
    sampleTopBytes = new Uint8Array(await readFile(fileURLToPath(SAMPLE_TOP_URL)));
    return sampleTopBytes;
}

/** Hydrate the saved document the way the editor does, then refuse a print order. */
export async function prepareHeadlessMillDesign(
    doc: unknown,
    millSide?: "LR" | "RR" | "LL",
): Promise<{
    design: MillDesign;
    sides: Array<"left" | "right">;
}> {
    const mod = await loadMillModule();
    const design = mod.designStateFromDocument(doc);
    mod.assertMilledCncOrder(design);
    // Omitted and LR keep the one-argument call so a pair file stays today's sides.
    if (millSide === "RR" || millSide === "LL") {
        return { design, sides: mod.millExportSides(design, undefined, millSide) };
    }
    return { design, sides: mod.millExportSides(design) };
}

/** Pair (or single-foot) CNC file. Bytes match `buildMillCncGcode` on the same design. */
export async function buildHeadlessMillCncGcode(
    design: unknown,
    millSide?: "LR" | "RR" | "LL",
): Promise<HeadlessMillGcode> {
    const mod = await loadMillModule();
    mod.assertMilledCncOrder(design as MillDesign);
    installBundledSampleTopFetch(await bundledSampleTop());
    const { Cache } = await import("three");
    Cache.clear();
    if (millSide === "RR" || millSide === "LL") {
        return mod.buildMillCncGcode({ design, millSide });
    }
    return mod.buildMillCncGcode({ design });
}
