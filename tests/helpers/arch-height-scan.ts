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
        pt(u, v);
        pt(u2, v2);
        pt(u3, v3);
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
