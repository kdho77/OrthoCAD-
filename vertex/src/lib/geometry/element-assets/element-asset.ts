// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, SphereGeometry, Vector3 } from "three";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { ElementKind, PlacedElement, Side } from "@/types";
import { type ElementHeightGrid, getOrRasterizeGrid, heightGridCacheKey } from "./height-grid";
import type {
    ElementAssetSidecar,
    ElementAssetTransform,
    ElementManifest,
    ElementPlacementMode,
    PlacedElementAssetContext,
} from "./types";

let manifestCache: ElementManifest | null = null;
const assetBytesCache = new Map<string, { hash: string; buffer: ArrayBuffer; syntheticFloat?: boolean }>();
const sidecarCache = new Map<string, ElementAssetSidecar>();

function canReadLocalElements(): boolean {
    return typeof process !== "undefined" && Boolean(process.versions?.node);
}

async function readElementsText(relativePath: string): Promise<string> {
    if (canReadLocalElements()) {
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const full = resolve(process.cwd(), "vertex/public/elements", relativePath);
        return readFileSync(full, "utf8");
    }
    const res = await fetch(`/elements/${relativePath}`);
    if (!res.ok) throw new Error(`Failed to fetch /elements/${relativePath}`);
    return res.text();
}

async function readElementsBuffer(relativePath: string): Promise<ArrayBuffer> {
    if (canReadLocalElements()) {
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const buf = readFileSync(resolve(process.cwd(), "vertex/public/elements", relativePath));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    const res = await fetch(`/elements/${relativePath}`);
    if (!res.ok) throw new Error(`Failed to fetch /elements/${relativePath}`);
    return res.arrayBuffer();
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

async function loadSidecar(file: string): Promise<ElementAssetSidecar> {
    const cached = sidecarCache.get(file);
    if (cached) return cached;
    const sc = JSON.parse(await readElementsText(file)) as ElementAssetSidecar;
    sidecarCache.set(file, sc);
    return sc;
}

function syntheticDomeBuffer(): ArrayBuffer {
    const dome = new SphereGeometry(5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = dome.getAttribute("position")!;
    const floats = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        floats[i * 3] = pos.getX(i);
        floats[i * 3 + 1] = pos.getY(i);
        floats[i * 3 + 2] = pos.getZ(i);
    }
    dome.dispose();
    return floats.buffer;
}

function isGlbBuffer(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 4) return false;
    const u = new Uint8Array(buffer, 0, 4);
    return u[0] === 0x67 && u[1] === 0x6c && u[2] === 0x54 && u[3] === 0x46;
}

async function loadAssetBuffer(
    assetId: string,
): Promise<{ hash: string; buffer: ArrayBuffer; syntheticFloat?: boolean }> {
    const cached = assetBytesCache.get(assetId);
    if (cached) return cached;
    const manifest = await loadElementManifest();
    const entry = manifest.elements.find((e) => e.id === assetId);
    if (!entry) throw new Error(`Unknown element asset id: ${assetId}`);
    let buffer: ArrayBuffer;
    let syntheticFloat = false;
    try {
        buffer = await readElementsBuffer(entry.glb);
    } catch {
        if (assetId !== "test-dome") throw new Error(`Missing element GLB: ${entry.glb}`);
        buffer = syntheticDomeBuffer();
        syntheticFloat = true;
    }
    const hash = await digestHex(buffer);
    const out = { hash, buffer, syntheticFloat };
    assetBytesCache.set(assetId, out);
    return out;
}

export function placementModeFor(placed: PlacedElement, sidecar: ElementAssetSidecar): ElementPlacementMode {
    return placed.placementMode ?? sidecar.defaultPlacementMode ?? "flow";
}

export function buildElementTransform(
    placed: PlacedElement,
    sidecar: ElementAssetSidecar,
    side: Side,
    _lengthMm: number,
    _widthMm: number,
): ElementAssetTransform {
    const scaleZ = sidecar.nominalPeakMm > 1e-6 ? placed.heightMm / sidecar.nominalPeakMm : 1;
    // Footprint stays true mm on the surface; only anchor follows #184 width affine.
    const scaleX = placed.scale.x;
    const scaleY = placed.scale.y;
    return {
        scaleX,
        scaleY,
        scaleZ,
        rotationDeg: placed.rotationDeg + sidecar.rotationDeg,
        mirrorX: side === "left",
        anchorUMm: placed.position.x,
        anchorVMm: placed.position.y,
        placementMode: placementModeFor(placed, sidecar),
        zOffsetMm: placed.zOffsetMm ?? 0,
        heightMm: placed.heightMm,
        category: sidecar.category,
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
        sidecar?.featherMm.toFixed(3) ?? "",
        sidecarHash ?? "",
    ].join(",");
}

export async function loadTransformedAssetPositions(
    assetId: string,
    transform: ElementAssetTransform,
): Promise<{ positions: Float32Array; grid: ElementHeightGrid; assetHash: string }> {
    const { hash, buffer, syntheticFloat } = await loadAssetBuffer(assetId);
    let pos: {
        count: number;
        getX: (i: number) => number;
        getY: (i: number) => number;
        getZ: (i: number) => number;
    };
    let geoDispose: (() => void) | null = null;
    let meshIndices: ArrayLike<number> | undefined;
    if (syntheticFloat || (assetId === "test-dome" && !isGlbBuffer(buffer))) {
        const dome = new SphereGeometry(5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
        meshIndices = dome.getIndex()!.array;
        const floats = new Float32Array(buffer);
        pos = {
            count: floats.length / 3,
            getX: (i) => floats[i * 3]!,
            getY: (i) => floats[i * 3 + 1]!,
            getZ: (i) => floats[i * 3 + 2]!,
        };
    } else {
        const group = await loadGlbFromBuffer(buffer);
        const merged = extractMergedGeometry(group);
        group.clear();
        if (!merged) throw new Error(`Element asset ${assetId} has no geometry`);
        const geo = merged.geometry;
        const attr = geo.getAttribute("position");
        if (!attr) throw new Error(`Element asset ${assetId} missing positions`);
        pos = attr;
        meshIndices = geo.getIndex()?.array;
        geoDispose = () => geo.dispose();
    }
    const out = new Float32Array(pos.count * 3);
    const m = new Matrix4();
    m.makeScale(transform.mirrorX ? -transform.scaleX : transform.scaleX, transform.scaleY, transform.scaleZ);
    const rot = new Matrix4().makeRotationZ((transform.rotationDeg * Math.PI) / 180);
    m.premultiply(rot);
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        v.applyMatrix4(m);
        out[i * 3] = v.x;
        out[i * 3 + 1] = v.y;
        out[i * 3 + 2] = v.z;
    }
    geoDispose?.();
    const cacheKey = heightGridCacheKey(hash, transformKey(transform));
    const grid = getOrRasterizeGrid(cacheKey, out, meshIndices);
    return { positions: out, grid, assetHash: hash };
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
        const t = buildElementTransform(el, sc, el.side, 1, 1);
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
    lengthMm: number,
    widthMm: number,
): Promise<PlacedElementAssetContext[]> {
    const manifest = await loadElementManifest();
    const out: PlacedElementAssetContext[] = [];
    for (const placed of elements) {
        if (placed.side !== side || placed.kind === "custom") continue;
        const entry = manifest.elements.find((e) => e.kind === placed.kind);
        if (!entry) continue;
        const sidecar = await loadSidecar(entry.sidecar);
        const { hash } = await loadAssetBuffer(entry.id);
        const transform = buildElementTransform(placed, sidecar, side, lengthMm, widthMm);
        out.push({
            placed,
            side,
            sidecar,
            assetId: entry.id,
            assetHash: hash,
            transform,
        });
    }
    return out;
}
