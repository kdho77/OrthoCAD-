// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BufferGeometry } from "three";
import * as THREE from "three";
import { getMarkerFrame, registerRawBaseGeometry } from "@/lib/geometry/marker-frame";
import {
    extractKeptGeometry,
    rankComponents,
    selectedComponentsBBox,
    weldAndLabelComponents,
} from "@/lib/geometry/scan-components";
import { buildScanDisplayInfo, buildScanDisplayInfoFromBBox } from "@/lib/geometry/scan-display";
import { suggestScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import type { ScanMarkers } from "@/stores/scan-store";
import type { Side } from "@/types";

export const DEFAULT_GLB_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

function soupGeometry(...parts: Float32Array[]): THREE.BufferGeometry {
    let total = 0;
    for (const p of parts) total += p.length;
    const merged = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
        merged.set(p, o);
        o += p.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(merged, 3));
    return geo;
}

function sheetSoup(cx: number, cy: number, cz: number, w: number, h: number): Float32Array {
    const hx = w / 2;
    const hy = h / 2;
    return new Float32Array([
        cx - hx,
        cy - hy,
        cz,
        cx + hx,
        cy - hy,
        cz,
        cx + hx,
        cy + hy,
        cz,
        cx - hx,
        cy - hy,
        cz,
        cx + hx,
        cy + hy,
        cz,
        cx - hx,
        cy + hy,
        cz,
    ]);
}

export function bulkyFootSoup(length = 0.26, width = 0.1, height = 0.08): Float32Array {
    const g = new THREE.SphereGeometry(length / 2, 24, 16);
    g.scale(1, width / length, height / length);
    g.translate(length / 2, 0, height / 2);
    const non = g.toNonIndexed();
    g.dispose();
    const arr = new Float32Array(non.getAttribute("position").array as ArrayLike<number>);
    non.dispose();
    return arr;
}

/** Ranked/cleaned bulky foot scan (scan-components representative fixture). */
export function buildBulkyFootKeptScan(side: Side): {
    geometry: BufferGeometry;
    display: ReturnType<typeof buildScanDisplayInfo>;
    suggested: ReturnType<typeof suggestScanLandmarks>;
} {
    const foot = bulkyFootSoup(0.26, 0.1, 0.08);
    const stray = sheetSoup(5, 0, 0, 1, 1);
    const raw = soupGeometry(foot, stray);
    const labeling = weldAndLabelComponents(raw);
    const ranked = rankComponents(labeling.components);
    const kept = extractKeptGeometry(raw, labeling, [ranked[0]!.id]);
    const prior = buildScanDisplayInfo(raw);
    const bbox = selectedComponentsBBox(ranked, [ranked[0]!.id]);
    const display = bbox
        ? buildScanDisplayInfoFromBBox(bbox.min, bbox.max, {
              inferredUnit: prior.inferredUnit,
              dominantRawAxis: prior.dominantRawAxis,
              rawLongest: prior.rawLongest,
          })
        : prior;
    const suggested = suggestScanLandmarks(kept, side);
    raw.dispose();
    return { geometry: kept, display, suggested };
}

export async function registerDefaultGlbBaseAsync(sourceAssetId: string): Promise<BufferGeometry> {
    const buf = readFileSync(DEFAULT_GLB_PATH);
    const group = await loadGlbFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("Default.glb fixture produced no geometry");
    const geo = reorientToFootprintFrame(merged.geometry);
    registerRawBaseGeometry(sourceAssetId, geo, { primarySide: "left" });
    return geo;
}

function makePlantarPatch(center: THREE.Vector3, outward: THREE.Vector3, size = 4): THREE.BufferGeometry {
    const n = outward.clone().normalize();
    const tmp = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(tmp, n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const p0 = center.clone().addScaledVector(u, -size).addScaledVector(v, -size);
    const p1 = center.clone().addScaledVector(u, size).addScaledVector(v, -size);
    const p2 = center.clone().addScaledVector(u, size).addScaledVector(v, size);
    const p3 = center.clone().addScaledVector(u, -size).addScaledVector(v, size);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array([
        p0.x,
        p0.y,
        p0.z,
        p1.x,
        p1.y,
        p1.z,
        p2.x,
        p2.y,
        p2.z,
        p0.x,
        p0.y,
        p0.z,
        p2.x,
        p2.y,
        p2.z,
        p3.x,
        p3.y,
        p3.z,
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, n.x, n.y, n.z);
    nor.needsUpdate = true;
    return geo;
}

function mergeScanGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    for (const g of geos) {
        const p = g.getAttribute("position");
        const n = g.getAttribute("normal");
        for (let i = 0; i < p.count; i++) {
            positions.push(p.getX(i), p.getY(i), p.getZ(i));
            normals.push(n.getX(i), n.getY(i), n.getZ(i));
        }
        g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    out.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
    return out;
}

/** Default.glb landmark-driven scan + markers (scan-registration-phase2 T9 pattern). */
export function buildDefaultGlbRegisteredScan(sourceAssetId: string): {
    geometry: BufferGeometry;
    display: ReturnType<typeof buildScanDisplayInfo>;
    markers: ScanMarkers;
    suggested: ReturnType<typeof suggestScanLandmarks>;
} | null {
    const frame = getMarkerFrame(sourceAssetId);
    if (!frame) return null;
    const basePts: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
        frame.landmarks.B1.clone(),
        frame.landmarks.B2.clone(),
        frame.landmarks.B3.clone(),
    ];
    const markersScan = basePts.map((p) => p.clone().add(new THREE.Vector3(0.4, -0.2, 0.1))) as [
        THREE.Vector3,
        THREE.Vector3,
        THREE.Vector3,
    ];
    const plantarOutward = new THREE.Vector3(0, 0, -1);
    const patches = markersScan.map((m) => makePlantarPatch(m, plantarOutward, 5));
    const arch = markersScan[0]!
        .clone()
        .lerp(markersScan[2]!, 0.42)
        .add(new THREE.Vector3(0, 8, 0));
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 4; j++) {
            const c = arch.clone().add(new THREE.Vector3(i * 3 - 10, j * 2 - 3, 0));
            patches.push(makePlantarPatch(c, plantarOutward, 3));
        }
    }
    const geometry = mergeScanGeometries(patches);
    const display = buildScanDisplayInfo(geometry);
    const markers: ScanMarkers = {
        M1: markersScan[0]!.clone(),
        M2: markersScan[1]!.clone(),
        M3: markersScan[2]!.clone(),
        ARCH: arch.clone(),
    };
    const suggested =
        suggestScanLandmarks(geometry, "left") ??
        ({
            M1: markers.M1!.clone(),
            M2: markers.M2!.clone(),
            M3: markers.M3!.clone(),
            ARCH: markers.ARCH?.clone(),
            archConfidence: "medium" as const,
        } as ReturnType<typeof suggestScanLandmarks>);
    return { geometry, display, markers, suggested };
}

export function archMarkerFromM1M3(m1: THREE.Vector3, m3: THREE.Vector3): THREE.Vector3 {
    return m1
        .clone()
        .lerp(m3, 0.4)
        .add(new THREE.Vector3(0, 5, 0));
}

/** mm-scale foot mesh (same topology as generateOrthoticFromScanAndRx unit tests) for real clinical match. */
export function syntheticFootGeometry(length = 270, side: Side = "left"): THREE.BufferGeometry {
    const positions: number[] = [];
    const pushTri = (
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        cx: number,
        cy: number,
        cz: number,
    ) => {
        positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    };
    const halfWidthAt = (u: number, s: 1 | -1): number => {
        let w = 20 + 15 * Math.sin(Math.PI * u);
        if (s === 1) {
            const d = (u - 0.75) / 0.04;
            w += 15 * Math.exp(-(d * d));
        } else {
            const d = (u - 0.65) / 0.04;
            w += 15 * Math.exp(-(d * d));
        }
        return w;
    };
    const nu = 80;
    const nv = 24;
    for (let iu = 0; iu < nu; iu++) {
        const u0 = iu / nu;
        const u1 = (iu + 1) / nu;
        for (let iv = 0; iv < nv; iv++) {
            const v0 = iv / nv;
            const v1 = (iv + 1) / nv;
            const yOf = (u: number, v: number) => {
                const wm = halfWidthAt(u, 1);
                const wl = halfWidthAt(u, -1);
                return v >= 0 ? v * wm : v * wl;
            };
            const zOf = (u: number, y: number) => {
                if (u < 1 / 3) return 2 + Math.abs(y) * 0.02;
                return 10 + 8 * u + Math.abs(y) * 0.05;
            };
            const x0 = u0 * length;
            const x1 = u1 * length;
            const vA = -1 + 2 * v0;
            const vB = -1 + 2 * v1;
            const y00 = yOf(u0, vA);
            const y10 = yOf(u1, vA);
            const y01 = yOf(u0, vB);
            const y11 = yOf(u1, vB);
            pushTri(x0, y00, zOf(u0, y00), x1, y10, zOf(u1, y10), x1, y11, zOf(u1, y11));
            pushTri(x0, y00, zOf(u0, y00), x1, y11, zOf(u1, y11), x0, y01, zOf(u0, y01));
        }
    }
    const foot = new THREE.BufferGeometry();
    foot.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (side === "right") {
        foot.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1));
    }
    return foot;
}

export function buildSyntheticFootScanBundle(
    side: Side = "left",
    lengthMm = 270,
): {
    geometry: BufferGeometry;
    display: ReturnType<typeof buildScanDisplayInfo>;
    suggested: ReturnType<typeof suggestScanLandmarks>;
} {
    const geometry = syntheticFootGeometry(lengthMm, side);
    const display = buildScanDisplayInfo(geometry);
    const suggested = suggestScanLandmarks(geometry, side);
    return { geometry, display, suggested };
}
