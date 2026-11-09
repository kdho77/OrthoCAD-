// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Loads the canonical Export loft in this process. Refuses a different mesh if that load fails.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface HeadlessFinalizedFoot {
    side: "left" | "right";
    stl: ArrayBuffer;
    solidTriangles: number;
    uploadTriangles: number;
    fingerprint: string;
}

interface FinalizedMeshModule {
    buildFinalizedFootFromSavedSettings(input: {
        settingsJson: unknown;
        side: "left" | "right";
        sampleTopBytes: ArrayBuffer;
        includeLeader?: boolean;
        fontBytes?: ArrayBuffer;
        elementsBaseDir?: string;
    }): Promise<HeadlessFinalizedFoot>;
}

const SAMPLE_TOP_URL = new URL("../../../public/Templates/SAMPLE_Top.glb", import.meta.url);
const TEXT_FONT_URL = new URL("../../../public/fonts/Inter-Bold.ttf", import.meta.url);
const ELEMENTS_DIR_URL = new URL("../../../public/elements/", import.meta.url);
const CANONICAL_EXPORT_LOFT_URL = new URL("./canonical-export-loft.js", import.meta.url);

let sampleTopBytes: ArrayBuffer | null = null;
let textFontBytes: ArrayBuffer | null = null;
let meshModule: FinalizedMeshModule | null = null;

async function ensureBrowserParser(): Promise<void> {
    const target = globalThis as unknown as { DOMParser?: unknown; self?: unknown };
    if (typeof target.DOMParser === "function") return;
    const { Window } = await import("happy-dom");
    const window = new Window();
    target.DOMParser = window.DOMParser;
    if (!target.self) target.self = globalThis;
}

async function loadMeshModule(): Promise<FinalizedMeshModule> {
    if (meshModule) return meshModule;
    await ensureBrowserParser();
    // Literal specifier so the Vercel file trace copies the bundle into /var/task.
    // Emitted by vertex/scripts/bundle-canonical-export-loft.mjs (vercel-build)
    // from src/features/exports/saved-design-finalized-mesh.ts. Do not import that
    // .ts path: @vercel/node does not ship raw client modules or rewrite `@/`.
    meshModule = (await import("./canonical-export-loft.js")) as FinalizedMeshModule;
    return meshModule;
}

function arrayBufferOf(bytes: Buffer): ArrayBuffer {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
}

async function bundledSampleTop(): Promise<ArrayBuffer> {
    if (sampleTopBytes) return sampleTopBytes;
    sampleTopBytes = arrayBufferOf(await readFile(fileURLToPath(SAMPLE_TOP_URL)));
    return sampleTopBytes;
}

async function bundledTextFont(): Promise<ArrayBuffer> {
    if (textFontBytes) return textFontBytes;
    textFontBytes = arrayBufferOf(await readFile(fileURLToPath(TEXT_FONT_URL)));
    return textFontBytes;
}

/**
 * Internal per-foot STL from saved parameters.
 * Uses the UI Export module. On failure, throws — callers must not substitute geometry.
 */
export async function buildHeadlessFinalizedFoot(input: {
    settingsJson: unknown;
    side: "left" | "right";
}): Promise<HeadlessFinalizedFoot> {
    try {
        const mod = await loadMeshModule();
        const sampleTop = await bundledSampleTop();
        const fontBytes = await bundledTextFont();
        return await mod.buildFinalizedFootFromSavedSettings({
            settingsJson: input.settingsJson,
            side: input.side,
            sampleTopBytes: sampleTop,
            includeLeader: true,
            fontBytes,
            elementsBaseDir: fileURLToPath(ELEMENTS_DIR_URL),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Canonical Export mesh is not available headless (${message}). Refusing to substitute a different mesh.`,
            { cause: error },
        );
    }
}

export function sampleTopFileUrl(): string {
    return SAMPLE_TOP_URL.href;
}

export function textFontFileUrl(): string {
    return TEXT_FONT_URL.href;
}

export function elementsDirectoryUrl(): string {
    return ELEMENTS_DIR_URL.href;
}

export function canonicalExportLoftUrl(): string {
    return CANONICAL_EXPORT_LOFT_URL.href;
}
