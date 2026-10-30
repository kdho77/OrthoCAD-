// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { type Font, parse as parseOpenType } from "opentype.js";
import { TEXT_FONT_ID, TEXT_FONT_PUBLIC_PATH } from "./constants";
import { TextMarkingError } from "./errors";

let cached: Font | null = null;
let inflight: Promise<Font> | null = null;

function parseFont(buffer: ArrayBuffer): Font {
    const font = parseOpenType(buffer);
    if (!font?.unitsPerEm) {
        throw new TextMarkingError("font", `failed to parse ${TEXT_FONT_ID}`);
    }
    return font;
}

async function loadFromNode(): Promise<Font | null> {
    if (typeof process === "undefined" || !process.versions?.node) return null;
    const { existsSync, readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const candidates = [
        resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf"),
        resolve(process.cwd(), "public/fonts/Inter-Bold.ttf"),
    ];
    for (const path of candidates) {
        if (!existsSync(path)) continue;
        const buf = readFileSync(path);
        return parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
    return null;
}

/** Bundled Inter Bold (OFL). Cached after the first successful load. */
export async function loadTextFont(): Promise<Font> {
    if (cached) return cached;
    if (!inflight) {
        inflight = (async () => {
            const fromNode = await loadFromNode();
            if (fromNode) {
                cached = fromNode;
                return fromNode;
            }
            const res = await fetch(TEXT_FONT_PUBLIC_PATH);
            if (!res.ok) {
                throw new TextMarkingError("font", `failed to load ${TEXT_FONT_ID}`);
            }
            const font = parseFont(await res.arrayBuffer());
            cached = font;
            return font;
        })().catch((e) => {
            inflight = null;
            throw e;
        });
    }
    return inflight;
}

export function capHeightFontSize(font: Font, capHeightMm: number): number {
    const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
    const cap = os2?.sCapHeight && os2.sCapHeight > 0 ? os2.sCapHeight : font.ascender * 0.72;
    const frac = cap / font.unitsPerEm;
    return capHeightMm / Math.max(frac, 1e-6);
}
