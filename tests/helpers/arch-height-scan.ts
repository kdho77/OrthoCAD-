// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import * as THREE from "three";
import type { Side } from "@/types";

/**
 * Plantar grid whose medial midfoot sits `heightMm` above a Z=0 floor.
 * Length is 250 mm. Used to drive one-click arch class without a gap fit.
 */
export function archHeightScan(heightMm: number, side: Side): THREE.BufferGeometry {
    const length = 250;
    const positions: number[] = [];
    const nu = 40;
    const nv = 10;
    const zAt = (u: number, y: number) => {
        const medial = side === "left" ? y > 1 : y < -1;
        if (u >= 0.3 && u <= 0.55 && medial) return heightMm;
        if (u <= 0.18 || u >= 0.8) return 0;
        return 0.4;
    };
    const push = (u: number, v: number, u2: number, v2: number, u3: number, v3: number) => {
        const pt = (uu: number, vv: number) => {
            const y = (vv * 2 - 1) * 42;
            positions.push(uu * length, y, zAt(uu, y));
        };
        // Winding faces the floor (−Z). A +Z winding would hide the plantar surface.
        pt(u, v);
        pt(u3, v3);
        pt(u2, v2);
    };
    for (let iu = 0; iu < nu; iu++) {
        const u0 = iu / nu;
        const u1 = (iu + 1) / nu;
        for (let iv = 0; iv < nv; iv++) {
            const v0 = iv / nv;
            const v1 = (iv + 1) / nv;
            push(u0, v0, u1, v0, u1, v1);
            push(u0, v0, u1, v1, u0, v1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
}

export type PlantarArchLandmarkScan = {
    geometry: THREE.BufferGeometry;
    landmarks: {
        heel: THREE.Vector3;
        m1: THREE.Vector3;
        m5: THREE.Vector3;
    };
    /** Plantar point at the arch plateau, for a manual marker. */
    apex: THREE.Vector3;
    /** Heel seat on the floor plane. Dragging the arch marker here drops the height. */
    heelSeat: THREE.Vector3;
    /** Highest decoy vertex (medial wall or cap). The plantar measure must ignore it. */
    decoyHeightMm: number;
};

type Pt = { x: number; y: number; z: number };

function pushTri(out: number[], a: Pt, b: Pt, c: Pt, wantDown: boolean) {
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const nz = ab.x * ac.y - ab.y * ac.x;
    const flip = wantDown ? nz > 0 : nz < 0;
    const p = flip ? [a, c, b] : [a, b, c];
    for (const v of p) out.push(v.x, v.y, v.z);
}

/**
 * Plantar sheet with a known medial arch plateau.
 * Optional medial wall and upward cap sit in the search band so a max-Z
 * measure would report the decoy instead of the arch.
 */
export function plantarArchScan(opts: {
    side?: Side;
    lengthMm?: number;
    widthMm?: number;
    archHeightMm: number;
    /** Vertical medial wall plus an upward cap at this height. 0 omits both. */
    decoyHeightMm?: number;
    /** Leave the medial arch band empty. */
    omitArchBand?: boolean;
}): PlantarArchLandmarkScan {
    const side = opts.side ?? "left";
    const length = opts.lengthMm ?? 260;
    const width = opts.widthMm ?? 90;
    const arch = opts.archHeightMm;
    const decoy = opts.decoyHeightMm ?? 0;
    const medialY = side === "left" ? width / 2 : -width / 2;
    const yAt = (v: number) => medialY + v * (-medialY - medialY);
    const positions: number[] = [];
    const nu = 52;
    const nv = 18;
    const zAt = (u: number, v: number) => {
        if (opts.omitArchBand && u >= 0.35 && u <= 0.55 && v >= 0 && v <= 0.35) return null;
        if (u >= 0.37 && u <= 0.53 && v >= 0.02 && v <= 0.32) return arch;
        return 0;
    };
    for (let iu = 0; iu < nu; iu++) {
        const u0 = iu / nu;
        const u1 = (iu + 1) / nu;
        for (let iv = 0; iv < nv; iv++) {
            const v0 = iv / nv;
            const v1 = (iv + 1) / nv;
            const z00 = zAt(u0, v0);
            const z10 = zAt(u1, v0);
            const z11 = zAt(u1, v1);
            const z01 = zAt(u0, v1);
            if (z00 == null || z10 == null || z11 == null || z01 == null) continue;
            const p00 = { x: u0 * length, y: yAt(v0), z: z00 };
            const p10 = { x: u1 * length, y: yAt(v0), z: z10 };
            const p11 = { x: u1 * length, y: yAt(v1), z: z11 };
            const p01 = { x: u0 * length, y: yAt(v1), z: z01 };
            pushTri(positions, p00, p10, p11, true);
            pushTri(positions, p00, p11, p01, true);
        }
    }
    if (decoy > 0) {
        const y = yAt(0);
        for (let iu = 18; iu < 28; iu++) {
            const u0 = iu / nu;
            const u1 = (iu + 1) / nu;
            const a = { x: u0 * length, y, z: 0 };
            const b = { x: u1 * length, y, z: 0 };
            const c = { x: u1 * length, y, z: decoy };
            const d = { x: u0 * length, y, z: decoy };
            pushTri(positions, a, b, c, true);
            pushTri(positions, a, c, d, true);
        }
        for (let iu = 20; iu < 26; iu++) {
            const u0 = iu / nu;
            const u1 = (iu + 1) / nu;
            for (let iv = 1; iv < 5; iv++) {
                const v0 = iv / nv;
                const v1 = (iv + 1) / nv;
                const p00 = { x: u0 * length, y: yAt(v0), z: decoy };
                const p10 = { x: u1 * length, y: yAt(v0), z: decoy };
                const p11 = { x: u1 * length, y: yAt(v1), z: decoy };
                const p01 = { x: u0 * length, y: yAt(v1), z: decoy };
                pushTri(positions, p00, p10, p11, false);
                pushTri(positions, p00, p11, p01, false);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const heel = new THREE.Vector3(0.02 * length, yAt(0.5), 0);
    const m1 = new THREE.Vector3(0.72 * length, yAt(0.08), 0);
    const m5 = new THREE.Vector3(0.72 * length, yAt(0.92), 0);
    return {
        geometry: geo,
        landmarks: { heel, m1, m5 },
        apex: new THREE.Vector3(0.45 * length, yAt(0.16), arch),
        heelSeat: heel.clone(),
        decoyHeightMm: decoy,
    };
}
