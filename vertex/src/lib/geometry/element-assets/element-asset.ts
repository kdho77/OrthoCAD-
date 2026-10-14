// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const MANIFEST_PATH = resolve(process.cwd(), "vertex/public/elements/index.json");
const ELEMENTS_DIR = resolve(process.cwd(), "vertex/public/elements");

let manifestCache: ElementManifest | null = null;
const assetBytesCache = new Map<string, { hash: string; buffer: ArrayBuffer; syntheticFloat?: boolean }>();
const sidecarCache = new Map<string, ElementAssetSidecar>();

export function loadElementManifest(): ElementManifest {
    if (!manifestCache) {
        manifestCache = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ElementManifest;
    }
    return manifestCache;
}

export function manifestEntryForKind(kind: ElementKind): { id: string; sidecar: ElementAssetSidecar } | null {
    const manifest = loadElementManifest();
    const entry = manifest.elements.find((e) => e.kind === kind);
    if (!entry) return null;
    return { id: entry.id, sidecar: loadSidecar(entry.sidecar) };
}

function loadSidecar(file: string): ElementAssetSidecar {
    const key = file;
    const cached = sidecarCache.get(key);
    if (cached) return cached;
    const sc = JSON.parse(readFileSync(resolve(ELEMENTS_DIR, file), "utf8")) as ElementAssetSidecar;
    sidecarCache.set(key, sc);
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

function loadAssetBuffer(assetId: string): { hash: string; buffer: ArrayBuffer; syntheticFloat?: boolean } {
    const cached = assetBytesCache.get(assetId);
    if (cached) return cached;
    const manifest = loadElementManifest();
    const entry = manifest.elements.find((e) => e.id === assetId);
    if (!entry) throw new Error(`Unknown element asset id: ${assetId}`);
    let buffer: ArrayBuffer;
    let syntheticFloat = false;
    const glbPath = resolve(ELEMENTS_DIR, entry.glb);
    try {
        const buf = readFileSync(glbPath);
        buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {
        if (assetId !== "synthetic-dome") throw new Error(`Missing element GLB: ${entry.glb}`);
        buffer = syntheticDomeBuffer();
        syntheticFloat = true;
    }
    const hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
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
    lengthMm: number,
    widthMm: number,
): ElementAssetTransform {
    const scaleZ = sidecar.nominalPeakMm > 1e-6 ? placed.heightMm / sidecar.nominalPeakMm : 1;
    const scaleXy = Math.max(placed.scale.x, placed.scale.y);
    return {
        scaleXy,
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

export function transformKey(t: ElementAssetTransform): string {
    return [
        t.scaleXy.toFixed(4),
        t.scaleZ.toFixed(4),
        t.rotationDeg.toFixed(3),
        t.mirrorX ? "L" : "R",
        t.anchorUMm.toFixed(3),
        t.anchorVMm.toFixed(3),
        t.placementMode,
        t.zOffsetMm.toFixed(3),
    ].join(",");
}

export async function loadTransformedAssetPositions(
    assetId: string,
    transform: ElementAssetTransform,
): Promise<{ positions: Float32Array; grid: ElementHeightGrid; assetHash: string }> {
    const { hash, buffer, syntheticFloat } = loadAssetBuffer(assetId);
    let pos: {
        count: number;
        getX: (i: number) => number;
        getY: (i: number) => number;
        getZ: (i: number) => number;
    };
    let geoDispose: (() => void) | null = null;
    if (syntheticFloat || (assetId === "synthetic-dome" && !isGlbBuffer(buffer))) {
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
        geoDispose = () => geo.dispose();
    }
    const out = new Float32Array(pos.count * 3);
    const m = new Matrix4();
    const s = transform.scaleXy;
    m.makeScale(transform.mirrorX ? -s : s, s, transform.scaleZ);
    const rot = new Matrix4().makeRotationZ((transform.rotationDeg * Math.PI) / 180);
    m.premultiply(rot);
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(m);
        out[i * 3] = v.x;
        out[i * 3 + 1] = v.y;
        out[i * 3 + 2] = v.z;
    }
    geoDispose?.();
    const cacheKey = heightGridCacheKey(hash, transformKey(transform));
    const grid = getOrRasterizeGrid(cacheKey, out);
    return { positions: out, grid, assetHash: hash };
}

export function hashElementAssetsForDesign(elements: PlacedElement[]): string {
    const manifest = loadElementManifest();
    const parts: string[] = [];
    for (const el of elements) {
        if (el.kind === "custom") continue;
        const entry = manifest.elements.find((e) => e.kind === el.kind);
        if (!entry) continue;
        const { hash } = loadAssetBuffer(entry.id);
        const sc = loadSidecar(entry.sidecar);
        const t = buildElementTransform(el, sc, el.side, 1, 1);
        parts.push(`${entry.id}:${hash}:${transformKey(t)}`);
    }
    return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function resolvePlacedAssetContexts(
    elements: PlacedElement[],
    side: Side,
    lengthMm: number,
    widthMm: number,
): PlacedElementAssetContext[] {
    const manifest = loadElementManifest();
    const out: PlacedElementAssetContext[] = [];
    for (const placed of elements) {
        if (placed.side !== side || placed.kind === "custom") continue;
        const entry = manifest.elements.find((e) => e.kind === placed.kind);
        if (!entry) continue;
        const sidecar = loadSidecar(entry.sidecar);
        const { hash } = loadAssetBuffer(entry.id);
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
