// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { extractMergedGeometry, loadGlbFromBuffer, mirrorGeometry } from "@/lib/library/loaders";
import type { ElementKind, PlacedElement, Side } from "@/types";
import {
    type ElementHeightGrid,
    flipHeightGridY,
    getOrRasterizeGrid,
    heightGridCacheKey,
} from "./height-grid";
import { elementSizeScale, sidecarAnchorUV } from "./sizing";
import {
    type ElementAssetSidecar,
    type ElementAssetTransform,
    type ElementManifest,
    type ElementPlacementMode,
    type PlacedElementAssetContext,
    sidecarFeatherKey,
} from "./types";

let manifestCache: ElementManifest | null = null;
const assetBytesCache = new Map<string, { hash: string; buffer: ArrayBuffer }>();
const sidecarCache = new Map<string, ElementAssetSidecar>();
const widthBasisCache = new Map<Side, BufferGeometry>();

function canReadLocalElements(): boolean {
    return typeof process !== "undefined" && Boolean(process.versions?.node);
}

/** SPA rewrite used to serve index.html for missing /elements/* (HTTP 200). */
export function isHtmlAssetPayload(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false;
    let head = "";
    for (let i = 0; i < Math.min(bytes.length, 32); i++) head += String.fromCharCode(bytes[i]!);
    const trimmed = head
        .replace(/^\uFEFF/, "")
        .trimStart()
        .toLowerCase();
    return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

export function assertElementAssetBytes(relativePath: string, bytes: Uint8Array): void {
    if (bytes.length < 12) {
        throw new Error(`Element asset /elements/${relativePath} is too small`);
    }
    if (isHtmlAssetPayload(bytes)) {
        throw new Error(`Element asset /elements/${relativePath} returned HTML (missing from build)`);
    }
    if (relativePath.endsWith(".glb")) {
        const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
        if (magic !== "glTF") {
            throw new Error(`Element asset /elements/${relativePath} is not a GLB`);
        }
    }
}

async function fetchElementsResponse(relativePath: string): Promise<Response> {
    const res = await fetch(`/elements/${relativePath}`);
    if (!res.ok) throw new Error(`Failed to fetch /elements/${relativePath} (${res.status})`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("text/html")) {
        throw new Error(`Element asset /elements/${relativePath} returned HTML (missing from build)`);
    }
    return res;
}

async function resolveElementsDir(): Promise<string> {
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const a = resolve(process.cwd(), "vertex/public/elements");
    const b = resolve(process.cwd(), "public/elements");
    if (existsSync(a)) return a;
    return b;
}

async function readElementsText(relativePath: string): Promise<string> {
    if (canReadLocalElements()) {
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        return readFileSync(resolve(await resolveElementsDir(), relativePath), "utf8");
    }
    const res = await fetchElementsResponse(relativePath);
    const text = await res.text();
    if (text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")) {
        throw new Error(`Element asset /elements/${relativePath} returned HTML (missing from build)`);
    }
    return text;
}

async function readElementsBuffer(relativePath: string): Promise<ArrayBuffer> {
    if (canReadLocalElements()) {
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const buf = readFileSync(resolve(await resolveElementsDir(), relativePath));
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        assertElementAssetBytes(relativePath, bytes);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    const res = await fetchElementsResponse(relativePath);
    const buffer = await res.arrayBuffer();
    assertElementAssetBytes(relativePath, new Uint8Array(buffer));
    return buffer;
}

export async function loadElementManifest(): Promise<ElementManifest> {
    if (!manifestCache) {
        manifestCache = JSON.parse(await readElementsText("index.json")) as ElementManifest;
    }
    return manifestCache;
}

export async function manifestEntryForKind(
    kind: ElementKind,
): Promise<{ id: string; sidecar: ElementAssetSidecar } | null> {
    const manifest = await loadElementManifest();
    const entry = manifest.elements.find((e) => e.kind === kind);
    if (!entry) return null;
    return { id: entry.id, sidecar: await loadSidecar(entry.sidecar) };
}

async function resolveSampleTopPath(): Promise<string | null> {
    if (!canReadLocalElements()) return null;
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const p of [
        resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"),
        resolve(process.cwd(), "vertex/../tests/fixtures/SAMPLE_Top.glb"),
    ]) {
        if (existsSync(p)) return p;
    }
    return null;
}

async function loadWidthBasisReference(
    side: Side,
    sidecar: ElementAssetSidecar,
): Promise<BufferGeometry | null> {
    if (!sidecar.widthBasis || !/SAMPLE_Top/i.test(sidecar.widthBasis)) return null;
    const cached = widthBasisCache.get(side);
    if (cached) return cached;
    const path = await resolveSampleTopPath();
    if (!path) return null;
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(path);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const m = mirrorGeometry(raw);
        raw.dispose();
        raw = m;
    }
    widthBasisCache.set(side, raw);
    return raw;
}

async function loadSidecar(file: string): Promise<ElementAssetSidecar> {
    const cached = sidecarCache.get(file);
    if (cached) return cached;
    const sc = JSON.parse(await readElementsText(file)) as ElementAssetSidecar;
    sidecarCache.set(file, sc);
    return sc;
}

export function placementModeFor(placed: PlacedElement, sidecar: ElementAssetSidecar): ElementPlacementMode {
    return placed.placementMode ?? sidecar.defaultPlacementMode ?? "flow";
}

export function buildElementTransform(
    placed: PlacedElement,
    sidecar: ElementAssetSidecar,
    side: Side,
    size: { scaleAlong: number; scaleAcross: number },
): ElementAssetTransform {
    const scaleZ = sidecar.nominalPeakMm > 1e-6 ? placed.heightMm / sidecar.nominalPeakMm : 1;
    // All bundled GLBs use the same local orientation as the approved dancer
    // pad: keep the source on the left foot and reflect its width on the right.
    // Legacy `.right` filenames / authoredSide labels do not describe the
    // displayed handedness after authoredToAppXY. Never mirror the insole here.
    const mirrorX = side === "right";
    return {
        scaleX: size.scaleAcross * placed.scale.y,
        scaleY: size.scaleAlong * placed.scale.x,
        scaleZ,
        rotationDeg: placed.rotationDeg + (sidecar.rotationDeg ?? 0),
        mirrorX,
        anchorUMm: placed.position.x,
        anchorVMm: placed.position.y,
        placementMode: placementModeFor(placed, sidecar),
        zOffsetMm: placed.zOffsetMm ?? 0,
        heightMm: placed.heightMm,
        category: sidecar.category === "sink" ? "sink" : "add",
    };
}

export function transformKey(
    t: ElementAssetTransform,
    sidecar?: ElementAssetSidecar,
    sidecarHash?: string,
): string {
    return [
        t.scaleX.toFixed(4),
        t.scaleY.toFixed(4),
        t.scaleZ.toFixed(4),
        t.rotationDeg.toFixed(3),
        t.mirrorX ? "L" : "R",
        t.anchorUMm.toFixed(3),
        t.anchorVMm.toFixed(3),
        t.placementMode,
        t.zOffsetMm.toFixed(3),
        t.category,
        sidecar ? sidecarFeatherKey(sidecar.featherMm) : "",
        sidecarHash ?? "",
    ].join(",");
}

async function loadAssetBuffer(assetId: string): Promise<{ hash: string; buffer: ArrayBuffer }> {
    const cached = assetBytesCache.get(assetId);
    if (cached) return cached;
    const manifest = await loadElementManifest();
    const entry = manifest.elements.find((e) => e.id === assetId);
    if (!entry) throw new Error(`Unknown element asset id: ${assetId}`);
    const buffer = await readElementsBuffer(entry.glb);
    const hash = await digestHex(buffer);
    const out = { hash, buffer };
    assetBytesCache.set(assetId, out);
    return out;
}

/**
 * Authored asset XY → local app footprint (X along length, Y across width).
 * Reflect authored X for the right-foot instance, around the element's anchor.
 */
export function authoredToAppXY(xMed: number, yToe: number, mirrorX: boolean): { x: number; y: number } {
    const mx = mirrorX ? -xMed : xMed;
    return { x: yToe, y: -mx };
}

export async function loadTransformedAssetPositions(
    assetId: string,
    transform: ElementAssetTransform,
): Promise<{ positions: Float32Array; indices: Uint32Array; grid: ElementHeightGrid; assetHash: string }> {
    const { hash, buffer } = await loadAssetBuffer(assetId);
    const group = await loadGlbFromBuffer(buffer);
    const merged = extractMergedGeometry(group);
    group.clear();
    if (!merged) throw new Error(`Element asset ${assetId} has no geometry`);
    const geo = merged.geometry;
    const attr = geo.getAttribute("position");
    if (!attr) throw new Error(`Element asset ${assetId} missing positions`);
    const out = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
        const ax = attr.getX(i) * transform.scaleX;
        const ay = attr.getY(i) * transform.scaleY;
        const az = Math.max(0, attr.getZ(i) * transform.scaleZ);
        // Rasterize the unreflected source, then flip Y for the opposite foot.
        const app = authoredToAppXY(ax, ay, false);
        out[i * 3] = app.x;
        out[i * 3 + 1] = app.y;
        out[i * 3 + 2] = az;
    }
    const index = geo.getIndex()?.array;
    geo.dispose();
    const cacheKey = heightGridCacheKey(hash, transformKey({ ...transform, mirrorX: false, rotationDeg: 0 }));
    let grid = getOrRasterizeGrid(cacheKey, out, index);
    if (transform.mirrorX) {
        grid = flipHeightGridY(grid);
        for (let i = 0; i < out.length / 3; i++) out[i * 3 + 1]! *= -1;
    }
    const indices = index ? Uint32Array.from(index) : Uint32Array.from({ length: attr.count }, (_, i) => i);
    if (transform.mirrorX) {
        for (let i = 0; i < indices.length; i += 3) {
            const b = indices[i + 1]!;
            indices[i + 1] = indices[i + 2]!;
            indices[i + 2] = b;
        }
    }
    return { positions: out, indices, grid, assetHash: hash };
}

export async function hashElementAssetsForDesign(elements: PlacedElement[]): Promise<string> {
    const manifest = await loadElementManifest();
    const parts: string[] = [];
    for (const el of elements) {
        if (el.kind === "custom") continue;
        const entry = manifest.elements.find((e) => e.kind === el.kind);
        if (!entry) continue;
        const { hash } = await loadAssetBuffer(entry.id);
        const sc = await loadSidecar(entry.sidecar);
        const scHash = await digestHex(new TextEncoder().encode(JSON.stringify(sc)).buffer);
        const t = buildElementTransform(el, sc, el.side, { scaleAlong: 1, scaleAcross: 1 });
        parts.push(`${entry.id}:${hash}:${transformKey(t, sc, scHash)}`);
    }
    return await digestHex(new TextEncoder().encode(parts.join("|")).buffer);
}

async function digestHex(buffer: ArrayBuffer): Promise<string> {
    if (!canReadLocalElements() && globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

export async function resolvePlacedAssetContexts(
    elements: PlacedElement[],
    side: Side,
    _lengthMm: number,
    _widthMm: number,
    base?: import("three").BufferGeometry,
    reference?: import("three").BufferGeometry | null,
): Promise<PlacedElementAssetContext[]> {
    const manifest = await loadElementManifest();
    const out: PlacedElementAssetContext[] = [];
    for (const placed of elements) {
        if (placed.side !== side || placed.kind === "custom") continue;
        const entry = manifest.elements.find((e) => e.kind === placed.kind);
        if (!entry) continue;
        try {
            const sidecar = await loadSidecar(entry.sidecar);
            const { hash } = await loadAssetBuffer(entry.id);
            const widthRef = (await loadWidthBasisReference(side, sidecar)) ?? reference;
            const size = base
                ? elementSizeScale(base, side, sidecar, widthRef)
                : { scaleAlong: 1, scaleAcross: 1, rawAlong: 1, rawAcross: 1, warning: undefined };
            const transform = buildElementTransform(placed, sidecar, side, size);
            out.push({
                placed,
                side,
                sidecar,
                assetId: entry.id,
                assetHash: hash,
                transform,
                scaleWarning: size.warning,
            });
        } catch (err) {
            console.warn(
                `[elements] skip ${placed.kind} (${entry.id}):`,
                err instanceof Error ? err.message : err,
            );
        }
    }
    return out;
}

export { sidecarAnchorUV };
