// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { Mesh, Points } from "three";
import { afoCastBodyStyle, afoTriangleStats } from "@/features/afo/afo-scan-ui";
import { applyClinicalCast } from "./cast";
import { applyAfoCorrections } from "./corrections";
import { defaultAfoCorrections, defaultAfoDesignState } from "./defaults";
import { afoMeshToGeometry, meshProjector, vertexCount } from "./mesh-ops";
import { registerTrimClick } from "./trim-loop";
import { afoTrimPreview } from "./trim-preview";
import { acceptTrimHit, fitSurfaceSpline } from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

/** Indexed cylinder in millimetres, standing on Z, entirely below the brace cap. */
function indexedCylinder(radius = 45, z0 = 20, z1 = 180, segs = 24, stacks = 12): AfoTriMesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const ringAt = (stack: number): number[] => {
        const z = z0 + ((z1 - z0) * stack) / stacks;
        const ids: number[] = [];
        for (let s = 0; s < segs; s++) {
            const a = (s / segs) * Math.PI * 2;
            ids.push(positions.length / 3);
            positions.push(Math.cos(a) * radius, Math.sin(a) * radius, z);
        }
        return ids;
    };
    let prev = ringAt(0);
    for (let stack = 1; stack <= stacks; stack++) {
        const cur = ringAt(stack);
        for (let s = 0; s < segs; s++) {
            const s2 = (s + 1) % segs;
            const a = prev[s] ?? 0;
            const b = prev[s2] ?? 0;
            const c = cur[s] ?? 0;
            const d = cur[s2] ?? 0;
            indices.push(a, b, d, a, d, c);
        }
        prev = cur;
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Same triangles, but each face owns private vertices. This is how an OBJ component is kept. */
function explodeToSoup(mesh: AfoTriMesh): AfoTriMesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const tris = (mesh.indices.length / 3) | 0;
    for (let t = 0; t < tris; t++) {
        const base = positions.length / 3;
        for (let k = 0; k < 3; k++) {
            const vi = mesh.indices[t * 3 + k] ?? 0;
            positions.push(
                mesh.positions[vi * 3] ?? 0,
                mesh.positions[vi * 3 + 1] ?? 0,
                mesh.positions[vi * 3 + 2] ?? 0,
            );
        }
        indices.push(base, base + 1, base + 2);
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function cylinderSamples(radius = 45, z0 = 40, z1 = 150, segs = 12, stacks = 6): AfoVec3[] {
    const samples: AfoVec3[] = [];
    for (let stack = 0; stack <= stacks; stack++) {
        const z = z0 + ((z1 - z0) * stack) / stacks;
        for (let s = 0; s < segs; s++) {
            const a = (s / segs) * Math.PI * 2;
            samples.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, z });
        }
    }
    return samples;
}

function meanSurfaceErrorMm(mesh: AfoTriMesh, samples: AfoVec3[]): number {
    const projector = meshProjector(mesh);
    let sum = 0;
    for (const sample of samples) sum += projector.closest(sample).errorMm;
    return sum / samples.length;
}

describe("OBJ triangle soup stays a solid cast", () => {
    test("default smoothing does not collapse an unwelded scan into specks", () => {
        const indexed = indexedCylinder();
        const soup = explodeToSoup(indexed);
        expect(vertexCount(soup)).toBe(soup.indices.length);
        const corrected = applyAfoCorrections(soup, defaultAfoCorrections());
        expect(vertexCount(corrected)).toBeLessThan(vertexCount(soup) / 2);
        const samples = cylinderSamples();
        expect(meanSurfaceErrorMm(corrected, samples)).toBeLessThan(1.5);
        const stats = afoTriangleStats(corrected.positions, corrected.indices);
        const style = afoCastBodyStyle({
            transparentOn: false,
            heightmap: false,
            triangleCount: stats.triangles,
            degenerateRatio: stats.degenerateRatio,
        });
        expect(style.drawMode).toBe("surface");
        expect(style.opacity).toBe(1);
        expect(style.transparent).toBe(false);
        const geometry = afoMeshToGeometry(corrected);
        const rendered = style.drawMode === "surface" ? new Mesh(geometry) : new Points(geometry);
        expect(rendered).toBeInstanceOf(Mesh);
        expect(rendered.type).toBe("Mesh");
        rendered.geometry.dispose();
    });

    test("an indexed cast keeps its vertex order when it is already welded", () => {
        const indexed = indexedCylinder();
        const corrected = applyAfoCorrections(indexed, defaultAfoCorrections());
        expect(corrected.positions.length).toBe(indexed.positions.length);
        expect(corrected.indices.length).toBe(indexed.indices.length);
        const i = 10;
        const drift = Math.hypot(
            (corrected.positions[i * 3] ?? 0) - (indexed.positions[i * 3] ?? 0),
            (corrected.positions[i * 3 + 1] ?? 0) - (indexed.positions[i * 3 + 1] ?? 0),
            (corrected.positions[i * 3 + 2] ?? 0) - (indexed.positions[i * 3 + 2] ?? 0),
        );
        expect(drift).toBeLessThan(5);
    });

    test("the cast offset does not separate an OBJ soup before the smooth", () => {
        const soup = explodeToSoup(indexedCylinder());
        const design = defaultAfoDesignState("left");
        const cast = applyClinicalCast(soup, design).mesh;
        const corrected = applyAfoCorrections(cast, design.corrections);
        expect(vertexCount(corrected)).toBeLessThan(vertexCount(soup) / 2);
        expect(meanSurfaceErrorMm(corrected, cylinderSamples())).toBeLessThan(4);
        const style = afoCastBodyStyle({
            transparentOn: false,
            heightmap: false,
            triangleCount: corrected.indices.length / 3,
            degenerateRatio: 0,
        });
        expect(style.drawMode).toBe("surface");
        expect(style.transparent).toBe(false);
        expect(style.opacity).toBe(1);
    });

    test("two clicks on the corrected cast add a handle and a line", () => {
        const corrected = applyAfoCorrections(explodeToSoup(indexedCylinder()), defaultAfoCorrections());
        const hits = cylinderSamples().slice(0, 2);
        let pins: AfoVec3[] = [];
        for (const hit of hits) {
            const accepted = acceptTrimHit(corrected, hit);
            expect(accepted).not.toBeNull();
            if (!accepted) continue;
            const next = registerTrimClick(pins, accepted);
            expect(next.added).toBe(true);
            pins = next.pins;
        }
        expect(pins).toHaveLength(2);
        const fit = fitSurfaceSpline(corrected, pins, { closed: false, quick: true });
        expect(fit.curve.length).toBeGreaterThan(0);
        expect(fit.display.length).toBeGreaterThan(0);
        const preview = afoTrimPreview({ points: pins, curve: fit.curve, placing: true });
        expect(preview.marks).toHaveLength(2);
        expect(preview.stroke.length).toBeGreaterThan(0);
    });
});
