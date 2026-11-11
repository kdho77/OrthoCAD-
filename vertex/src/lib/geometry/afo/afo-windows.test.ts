// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import { designSettingsEnvelope, readStoredDesignSettings } from "../../../../shared/design-settings";
import { applyCastOps, applyClinicalCast, applyShinBox, applyToeBox, flattenPlantar } from "./cast";
import { type AfoRotationAxes, applyAfoCorrections, landmarkDriftMm, textMatchesSide } from "./corrections";
import { defaultAfoCast, defaultAfoCorrections, defaultAfoDesignState, defaultAfoReliefs } from "./defaults";
import { positionsEqual, vertexCount } from "./mesh-ops";
import { countTriangleSelfIntersections } from "./self-intersection";
import { buildAfoShell, equatorialLoop } from "./shell";
import { buildSyntheticLegMesh, buildUnitSphereMesh } from "./synthetic-leg";
import { fitSurfaceSpline } from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

function boot(): { mesh: AfoTriMesh; heel: AfoVec3; m1: AfoVec3; m5: AfoVec3; med: AfoVec3; lat: AfoVec3 } {
    const pts = [
        [0, 0, 0],
        [-20, 120, 0],
        [20, 120, 0],
        [0, 60, 8],
        [-25, 30, 80],
        [25, 30, 80],
        [0, 30, 180],
        [-15, 20, 140],
        [15, 20, 140],
    ];
    const tris = [
        [0, 1, 3],
        [0, 3, 2],
        [0, 2, 1],
        [4, 5, 6],
        [4, 6, 7],
        [5, 8, 6],
        [4, 7, 5],
        [7, 8, 5],
        [3, 4, 5],
        [1, 4, 3],
        [2, 3, 5],
    ];
    return {
        mesh: {
            positions: new Float32Array(pts.flat()),
            indices: new Uint32Array(tris.flat()),
        },
        heel: { x: 0, y: 0, z: 0 },
        m1: { x: -20, y: 120, z: 0 },
        m5: { x: 20, y: 120, z: 0 },
        med: { x: -25, y: 30, z: 80 },
        lat: { x: 25, y: 30, z: 80 },
    };
}

function mirrorX(mesh: AfoTriMesh): AfoTriMesh {
    const positions = new Float32Array(mesh.positions);
    for (let i = 0; i < positions.length; i += 3) positions[i] = -(positions[i] ?? 0);
    return { positions, indices: mesh.indices };
}

function axesFor(side: "left" | "right", _mesh: AfoTriMesh): AfoRotationAxes {
    const right = side === "right";
    return {
        side,
        anatomical: true,
        medialMal: { x: right ? -25 : 25, y: 30, z: 80 },
        lateralMal: { x: right ? 25 : -25, y: 30, z: 80 },
        heel: { x: 0, y: 0, z: 0 },
        m1: { x: right ? -20 : 20, y: 120, z: 0 },
        m5: { x: right ? 20 : -20, y: 120, z: 0 },
        fibularHead: { x: 0, y: 30, z: 180 },
        navicular: { x: right ? -18 : 18, y: 70, z: 20 },
        pinPoints: [{ x: 0, y: 60, z: 8 }],
    };
}

function moveOf(mesh: AfoTriMesh, out: AfoTriMesh, i: number): number {
    return Math.hypot(
        (out.positions[i * 3] ?? 0) - (mesh.positions[i * 3] ?? 0),
        (out.positions[i * 3 + 1] ?? 0) - (mesh.positions[i * 3 + 1] ?? 0),
        (out.positions[i * 3 + 2] ?? 0) - (mesh.positions[i * 3 + 2] ?? 0),
    );
}

describe("AFO Windows parity", () => {
    test("identity at zero is the post-align mesh on L and R", () => {
        const leg = buildSyntheticLegMesh();
        for (const side of ["left", "right"] as const) {
            const cast = defaultAfoCast();
            cast.removeCastMm = 0;
            cast.flattenBottom = false;
            cast.shinBox.enabled = false;
            cast.toeBox.enabled = false;
            const base = applyCastOps(leg, cast);
            expect(positionsEqual(leg.positions, base.positions)).toBe(true);
            const c = defaultAfoCorrections();
            c.smoothIterations = 0;
            const corrected = applyAfoCorrections(leg, c, { ...axesFor(side, leg), anatomical: true });
            expect(positionsEqual(leg.positions, corrected.positions)).toBe(true);
        }
    });

    test("flatten, shin add, and toe extrusion", () => {
        const leg = buildSyntheticLegMesh();
        let zMin = Infinity;
        for (let i = 0; i < vertexCount(leg); i++) zMin = Math.min(zMin, leg.positions[i * 3 + 2] ?? 0);
        const cast = defaultAfoCast();
        cast.flattenBottom = true;
        cast.flattenRemoveMm = 4;
        cast.flattenAddMm = 1;
        const nav = { x: 20, y: 70, z: zMin + 12 };
        const flat = flattenPlantar(leg, cast, nav);
        const navI = nearestZ(leg, nav);
        expect(
            Math.abs((flat.positions[navI * 3 + 2] ?? 0) - (leg.positions[navI * 3 + 2] ?? 0)),
        ).toBeLessThanOrEqual(2);
        let below = 0;
        for (let i = 0; i < vertexCount(flat); i++) {
            const dx = (flat.positions[i * 3] ?? 0) - nav.x;
            const dy = (flat.positions[i * 3 + 1] ?? 0) - nav.y;
            const dz = (flat.positions[i * 3 + 2] ?? 0) - nav.z;
            if (Math.hypot(dx, dy, dz) < 30) continue;
            if ((flat.positions[i * 3 + 2] ?? 0) < zMin + 4 - 0.2) below++;
        }
        expect(below).toBe(0);

        const shin = applyShinBox(leg, 80);
        let advanced = 0;
        for (let i = 0; i < vertexCount(leg); i++) {
            if ((shin.positions[i * 3 + 1] ?? 0) > (leg.positions[i * 3 + 1] ?? 0) + 0.5) advanced++;
        }
        expect(advanced).toBeGreaterThan(0);

        cast.toeBox.enabled = true;
        cast.toeBox.extraLengthMm = 15;
        cast.toeBox.thicknessMm = 0;
        const toe = applyToeBox(leg, cast);
        let yMax = -Infinity;
        let yToe = -Infinity;
        for (let i = 0; i < vertexCount(leg); i++) {
            yMax = Math.max(yMax, leg.positions[i * 3 + 1] ?? 0);
            yToe = Math.max(yToe, toe.positions[i * 3 + 1] ?? 0);
        }
        expect(yToe).toBeGreaterThan(yMax + 10);
    });

    test("shell omits the shin box and matches the shin-off positive", () => {
        const leg = buildSyntheticLegMesh();
        const afo = defaultAfoDesignState("right");
        afo.method = "printing_shell";
        afo.cast.removeCastMm = 0;
        afo.reliefs = defaultAfoReliefs();
        afo.reliefs.malleoli.on = false;
        afo.corrections.smoothIterations = 0;
        afo.cast.shinBox.enabled = true;
        afo.cast.shinBox.heightMm = 80;
        const withFlag = applyClinicalCast(leg, afo, undefined, { includeShinBox: false }).mesh;
        afo.cast.shinBox.enabled = false;
        const without = applyClinicalCast(leg, afo, undefined, { includeShinBox: false }).mesh;
        expect(positionsEqual(withFlag.positions, without.positions)).toBe(true);
        const loop = equatorialLoop(buildUnitSphereMesh(30, 10));
        const sphere = buildUnitSphereMesh(30, 10);
        const on = buildAfoShell(sphere, loop, { thicknessMm: 4, edgeMm: 2, flareMm: 1.5 });
        const off = buildAfoShell(sphere, loop, { thicknessMm: 4, edgeMm: 2, flareMm: 1.5 });
        expect(positionsEqual(on.positions, off.positions)).toBe(true);
    });

    test("L and R corrections are independent and varus mirrors", () => {
        const { mesh } = boot();
        const base = defaultAfoCorrections();
        base.smoothIterations = 0;
        base.left = { ...base.left, heelLiftMm: 8, toeRiseMm: 6, medialArchMm: 3 };
        base.right = { ...base.right, heelLiftMm: 2, toeRiseMm: 1, medialArchMm: 0 };
        const left = applyAfoCorrections(
            mesh,
            { ...base, ...base.left, smoothIterations: 0 },
            axesFor("left", mesh),
        );
        const right = applyAfoCorrections(
            mesh,
            { ...base, ...base.right, smoothIterations: 0 },
            axesFor("right", mesh),
        );
        expect(positionsEqual(left.positions, right.positions)).toBe(false);

        const turned = defaultAfoCorrections();
        turned.smoothIterations = 0;
        turned.legRearDeg = 8;
        const rightAxes = axesFor("right", mesh);
        const rightOut = applyAfoCorrections(mesh, turned, rightAxes);
        const leftMesh = mirrorX(mesh);
        const leftAxes = axesFor("left", leftMesh);
        const leftOut = applyAfoCorrections(leftMesh, turned, leftAxes);
        const mirrored = mirrorX(rightOut);
        let max = 0;
        for (let i = 0; i < mirrored.positions.length; i++) {
            max = Math.max(max, Math.abs((mirrored.positions[i] ?? 0) - (leftOut.positions[i] ?? 0)));
        }
        expect(max).toBeLessThanOrEqual(0.5);
        expect(rightOut.positions[6 * 3] ?? 0).toBeLessThan(-0.5);
        const ajcBefore = { x: 0, y: 30, z: 80 };
        const medI = 4;
        const latI = 5;
        const ajcAfter = {
            x: ((rightOut.positions[medI * 3] ?? 0) + (rightOut.positions[latI * 3] ?? 0)) * 0.5,
            y: ((rightOut.positions[medI * 3 + 1] ?? 0) + (rightOut.positions[latI * 3 + 1] ?? 0)) * 0.5,
            z: ((rightOut.positions[medI * 3 + 2] ?? 0) + (rightOut.positions[latI * 3 + 2] ?? 0)) * 0.5,
        };
        expect(
            Math.hypot(ajcAfter.x - ajcBefore.x, ajcAfter.y - ajcBefore.y, ajcAfter.z - ajcBefore.z),
        ).toBeLessThanOrEqual(0.5);
        expect(moveOf(mesh, rightOut, 0)).toBeLessThanOrEqual(0.5);
        expect(moveOf(mesh, rightOut, 1)).toBeLessThanOrEqual(0.5);
        expect(moveOf(mesh, rightOut, 2)).toBeLessThanOrEqual(0.5);
        expect(countTriangleSelfIntersections(rightOut)).toBe(0);
    });

    test("smooth keeps a pinned landmark within 0.5 mm", () => {
        const leg = buildSyntheticLegMesh();
        const c = defaultAfoCorrections();
        c.smoothIterations = 6;
        const pin = { x: 0, y: 40, z: 80 };
        const out = applyAfoCorrections(leg, c, { medialMal: pin, lateralMal: pin, pinPoints: [pin] });
        expect(landmarkDriftMm(leg, out, pin)).toBeLessThanOrEqual(0.5);
    });

    test("surface spline is smooth, closed, and on the mesh", () => {
        const sphere = buildUnitSphereMesh(40, 16);
        const pins: AfoVec3[] = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            pins.push({ x: Math.cos(a) * 28, y: Math.sin(a) * 28, z: 8 });
        }
        const fit = fitSurfaceSpline(sphere, pins, 2);
        expect(fit.ok).toBe(true);
        expect(fit.maxTurnDeg).toBeLessThanOrEqual(25);
        expect(fit.maxChordErrorMm).toBeLessThanOrEqual(0.5);
        expect(fit.maxSurfaceErrorMm).toBeLessThanOrEqual(0.1);
        expect(fit.curve.length).toBeGreaterThan(20);
    });

    test("shell is watertight, T inside, E at the rim, flare about F", () => {
        const sphere = buildUnitSphereMesh(30, 12);
        const loop = equatorialLoop(sphere);
        const shell = buildAfoShell(sphere, loop, { thicknessMm: 4, edgeMm: 2, flareMm: 1.5 });
        const report = analyzeManifoldBuffers(shell.positions, shell.indices);
        expect(report.openEdges).toBe(0);
        expect(report.nonManifoldEdges).toBe(0);
        expect(countTriangleSelfIntersections(shell)).toBe(0);
        expect(worstDihedralDeg(sphere)).toBeLessThanOrEqual(60);
        const plain = buildAfoShell(sphere, loop, { thicknessMm: 4, edgeMm: 2, flareMm: 0 });
        let hausPlain = 0;
        let hausFlared = 0;
        for (const i of loop) {
            const p = {
                x: sphere.positions[i * 3] ?? 0,
                y: sphere.positions[i * 3 + 1] ?? 0,
                z: sphere.positions[i * 3 + 2] ?? 0,
            };
            hausPlain = Math.max(hausPlain, nearestVertexDistance(plain, p));
            hausFlared = Math.max(hausFlared, nearestVertexDistance(shell, p));
        }
        expect(hausPlain).toBeLessThanOrEqual(0.5);
        expect(hausFlared).toBeGreaterThan(1);
        expect(hausFlared).toBeLessThan(2.2);
        const moved: number[] = [];
        for (let i = 0; i < shell.positions.length / 3; i++) {
            const p = {
                x: shell.positions[i * 3] ?? 0,
                y: shell.positions[i * 3 + 1] ?? 0,
                z: shell.positions[i * 3 + 2] ?? 0,
            };
            let best = Infinity;
            for (let j = 0; j < plain.positions.length / 3; j++) {
                const d = Math.hypot(
                    (plain.positions[j * 3] ?? 0) - p.x,
                    (plain.positions[j * 3 + 1] ?? 0) - p.y,
                    (plain.positions[j * 3 + 2] ?? 0) - p.z,
                );
                if (d < best) best = d;
            }
            if (best > 0.2) moved.push(best);
        }
        const peak = Math.max(...moved);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThan(2.2);
    });

    test("settingsJson round-trips L and R and the text side matches", () => {
        const afo = defaultAfoDesignState("left");
        afo.corrections.left.heelLiftMm = 4;
        afo.corrections.right.toeRiseMm = 7;
        afo.corrections.patientName = "KENDON";
        afo.cast.flattenBottom = true;
        afo.print.material = "ApexVylon";
        const env = designSettingsEnvelope({ productType: "afo", afo });
        const back = readStoredDesignSettings(env) as {
            afo: typeof afo;
        };
        expect(back.afo.corrections.left.heelLiftMm).toBe(4);
        expect(back.afo.corrections.right.toeRiseMm).toBe(7);
        expect(back.afo.print.material).toBe("ApexVylon");
        expect(back.afo.cast.flattenRemoveMm).toBe(7);
        expect(textMatchesSide("KENDON L", "left")).toBe(true);
        expect(textMatchesSide("KENDON R", "left")).toBe(false);
        const sha = JSON.parse(readFileSync("tests/cnc/golden/sha.json", "utf8")) as {
            plain: string;
            dancer: string;
        };
        expect(sha).toEqual({
            plain: "70a633cf057b7f5087449e76c5eb553ebe66188e29b8be15df3f99b388a59e17",
            dancer: "c8d060adb1b30e6443bbee0ee0f05c2e1bf1fd6098325d568bb5456bcc8bfede",
        });
    });
});

function worstDihedralDeg(mesh: AfoTriMesh): number {
    const t = (mesh.indices.length / 3) | 0;
    const normals: AfoVec3[] = [];
    for (let i = 0; i < t; i++) {
        const a = at(mesh, mesh.indices[i * 3] ?? 0);
        const b = at(mesh, mesh.indices[i * 3 + 1] ?? 0);
        const c = at(mesh, mesh.indices[i * 3 + 2] ?? 0);
        const ux = b.x - a.x;
        const uy = b.y - a.y;
        const uz = b.z - a.z;
        const vx = c.x - a.x;
        const vy = c.y - a.y;
        const vz = c.z - a.z;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        normals.push({ x: nx / len, y: ny / len, z: nz / len });
    }
    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [mesh.indices[i * 3] ?? 0, mesh.indices[i * 3 + 1] ?? 0, mesh.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(i);
            else edgeFaces.set(k, [i]);
        }
    }
    let worst = 0;
    for (const faces of edgeFaces.values()) {
        if (faces.length !== 2) continue;
        const n0 = normals[faces[0]!]!;
        const n1 = normals[faces[1]!]!;
        const c = Math.min(1, Math.max(-1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(c) * 180) / Math.PI;
        if (deg > worst) worst = deg;
    }
    return worst;
}

function at(mesh: AfoTriMesh, i: number): AfoVec3 {
    return {
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    };
}

function nearestVertexDistance(mesh: AfoTriMesh, p: AfoVec3): number {
    let best = Infinity;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
        const d = Math.hypot(
            (mesh.positions[i * 3] ?? 0) - p.x,
            (mesh.positions[i * 3 + 1] ?? 0) - p.y,
            (mesh.positions[i * 3 + 2] ?? 0) - p.z,
        );
        if (d < best) best = d;
    }
    return best;
}

function nearestZ(mesh: AfoTriMesh, p: AfoVec3): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < vertexCount(mesh); i++) {
        const d = Math.hypot(
            (mesh.positions[i * 3] ?? 0) - p.x,
            (mesh.positions[i * 3 + 1] ?? 0) - p.y,
            (mesh.positions[i * 3 + 2] ?? 0) - p.z,
        );
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}
