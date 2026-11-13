// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { Matrix4, Mesh, Points, Vector3 } from "three";
import { afoCastBodyStyle, afoTriangleStats } from "@/features/afo/afo-scan-ui";
import {
    afoScanLandmarkKeyLightOffAxisDistanceMm,
    afoScanLandmarkKeyLightPosition,
} from "@/components/viewer/afo-scan-landmark-lighting-config";
import {
    AFO_FLAT_TRIM_BLEND_MM,
    AFO_FLAT_TRIM_LATERAL_INSET_RATIO,
    AFO_FLAT_TRIM_MEDIAL_INSET_MM,
    AFO_FLAT_TRIM_MIN_RADIUS_MM,
    AFO_FLAT_TRIM_TOE_INSET_MM,
    AFO_EDGE_MM,
    AFO_FLARE_MM,
} from "./defaults";
import { afoMeshToGeometry } from "./mesh-ops";
import { buildAfoShell, trimPolygonForShell } from "./shell";
import {
    contactPlanesFromLandmarks,
    flatPlateLockOf,
    heightAboveContact,
    validateFlatPlate,
} from "./shell-flatten";
import { buildCurledAfoCast } from "./curled-afo-cast";
import { fairTrimNearPins, flatPlateTrimLoop } from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sub(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function openLoop(curve: AfoVec3[]): AfoVec3[] {
    if (curve.length >= 2 && dist(curve[0]!, curve[curve.length - 1]!) < 0.3) return curve.slice(0, -1);
    return curve;
}

function circumradius(a: AfoVec3, b: AfoVec3, c: AfoVec3): number {
    const ab = dist(a, b);
    const bc = dist(b, c);
    const ca = dist(c, a);
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const cross = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (cross < 1e-6) return Infinity;
    return (ab * bc * ca) / (2 * cross);
}

function frameOf(mesh: AfoTriMesh, spec: { heel: AfoVec3; m1: AfoVec3; m5: AfoVec3 }) {
    const planes = contactPlanesFromLandmarks({ ...spec, thicknessMm: 4 });
    const samples: { s: number; v: number }[] = [];
    const n = (mesh.positions.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        const p = {
            x: mesh.positions[i * 3] ?? 0,
            y: mesh.positions[i * 3 + 1] ?? 0,
            z: mesh.positions[i * 3 + 2] ?? 0,
        };
        const h = heightAboveContact(p, planes);
        if (h < -6 || h > 22) continue;
        const d = sub(p, planes.origin);
        samples.push({ s: dot(d, planes.forward), v: dot(d, planes.along) });
    }
    return { planes, samples };
}

function silhouetteAt(
    samples: { s: number; v: number }[],
    s: number,
    window = 8,
): { vMed: number; vLat: number } | null {
    let vMed = Infinity;
    let vLat = -Infinity;
    for (const p of samples) {
        if (Math.abs(p.s - s) > window) continue;
        vMed = Math.min(vMed, p.v);
        vLat = Math.max(vLat, p.v);
    }
    if (!Number.isFinite(vMed)) return null;
    return { vMed, vLat };
}

function loopSV(
    curve: AfoVec3[],
    planes: ReturnType<typeof contactPlanesFromLandmarks>,
): { s: number; v: number; p: AfoVec3 }[] {
    return openLoop(curve).map((p) => {
        const d = sub(p, planes.origin);
        return { s: dot(d, planes.forward), v: dot(d, planes.along), p };
    });
}

describe("flat plate trim", () => {
    test("the default loop is inset, smooth, and closed on both feet", () => {
        for (const side of ["left", "right"] as const) {
            const cast = buildCurledAfoCast(side, 36, 16);
            const spec = { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm: 4 };
            const loop = flatPlateTrimLoop(cast.mesh, spec);
            expect(loop.pins.length, side).toBeGreaterThanOrEqual(6);
            expect(loop.curve.length, side).toBeGreaterThan(loop.pins.length);
            expect(loop.minRadiusMm, side).toBeGreaterThanOrEqual(AFO_FLAT_TRIM_MIN_RADIUS_MM - 1);
            const { planes, samples } = frameOf(cast.mesh, spec);
            const sv = loopSV(loop.curve, planes);
            let sMin = Infinity;
            let sMax = -Infinity;
            for (const p of samples) {
                sMin = Math.min(sMin, p.s);
                sMax = Math.max(sMax, p.s);
            }
            const sMid = sMin + (sMax - sMin) * 0.42;
            const edge = silhouetteAt(samples, sMid);
            expect(edge, side).toBeTruthy();
            const near = sv.filter((p) => Math.abs(p.s - sMid) < 10);
            expect(near.length, side).toBeGreaterThan(0);
            const width = edge!.vLat - edge!.vMed;
            const lateral = Math.max(...near.map((p) => p.v));
            const medial = Math.min(...near.map((p) => p.v));
            const lateralInset = edge!.vLat - lateral;
            const medialInset = medial - edge!.vMed;
            expect(lateralInset, `${side} lateral inset`).toBeGreaterThan(width * AFO_FLAT_TRIM_LATERAL_INSET_RATIO * 0.55);
            expect(lateralInset, `${side} lateral inset`).toBeLessThan(width * AFO_FLAT_TRIM_LATERAL_INSET_RATIO * 1.45);
            expect(medialInset, `${side} medial inset`).toBeGreaterThan(1);
            expect(medialInset, `${side} medial inset`).toBeLessThan(AFO_FLAT_TRIM_MEDIAL_INSET_MM + 10);
            expect(lateralInset, side).toBeGreaterThan(medialInset);

            const sFore = sMin + (sMax - sMin) * 0.82;
            const fore = sv.filter((p) => Math.abs(p.s - sFore) < 12);
            expect(fore.length, side).toBeGreaterThan(0);
            const foreSpan = Math.max(...fore.map((p) => p.v)) - Math.min(...fore.map((p) => p.v));
            expect(foreSpan, `${side} forefoot sweep`).toBeLessThan(width * 0.72);

            const toeTip = Math.max(...sv.map((p) => p.s));
            expect(sMax - toeTip, `${side} toe tab`).toBeGreaterThan(AFO_FLAT_TRIM_TOE_INSET_MM * 0.45);
            const heelBack = Math.min(...sv.map((p) => p.s));
            expect(heelBack - sMin, `${side} heel inset`).toBeGreaterThan(4);

            const plan = sv.map((p) => ({ x: p.s, y: p.v, z: 0 }));
            let maxTurn = 0;
            const n = plan.length;
            for (let i = 0; i < n; i++) {
                const a = plan[(i - 1 + n) % n]!;
                const b = plan[i]!;
                const c = plan[(i + 1) % n]!;
                const v1 = sub(b, a);
                const v2 = sub(c, b);
                const l1 = Math.hypot(v1.x, v1.y) || 1;
                const l2 = Math.hypot(v2.x, v2.y) || 1;
                const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)));
                maxTurn = Math.max(maxTurn, (Math.acos(cos) * 180) / Math.PI);
            }
            expect(maxTurn, `${side} turning angle`).toBeLessThan(18);

            const kappas = plan.map((p, i) => {
                const reach = 4;
                const radius = circumradius(plan[(i - reach + n) % n]!, p, plan[(i + reach) % n]!);
                return Number.isFinite(radius) && radius > 0 ? 1 / radius : 0;
            });
            let sharpest = 0;
            for (let i = 0; i < n; i++) {
                let walked = 0;
                for (let k = 1; k < n; k++) {
                    const j = (i + k) % n;
                    walked += dist(plan[(j - 1 + n) % n]!, plan[j]!);
                    if (walked >= 6 && walked <= AFO_FLAT_TRIM_BLEND_MM) {
                        sharpest = Math.max(sharpest, Math.abs(kappas[i]! - kappas[j]!) / walked);
                    }
                    if (walked > AFO_FLAT_TRIM_BLEND_MM) break;
                }
            }
            expect(sharpest, `${side} curvature step`).toBeLessThan(1 / (AFO_FLAT_TRIM_MIN_RADIUS_MM * 8));

            for (const pin of loop.pins) {
                let best = Infinity;
                for (const p of loop.curve) best = Math.min(best, dist(p, pin));
                expect(best, side).toBeLessThanOrEqual(0.5);
            }
        }
    });

    test("fairing keeps dragged pins and does not leave a jagged step", () => {
        const cast = buildCurledAfoCast("left", 28, 12);
        const loop = flatPlateTrimLoop(cast.mesh, {
            heel: cast.heel,
            m1: cast.m1,
            m5: cast.m5,
            thicknessMm: 4,
        });
        const pins = loop.pins.map((p) => ({ ...p }));
        const dragged = pins.map((p, i) => (i === 2 ? { ...p, y: p.y + (p.y >= 0 ? -6 : 6) } : p));
        const jagged = [...loop.curve];
        const mid = Math.floor(jagged.length / 2);
        const spike = jagged[mid];
        if (spike) jagged[mid] = { ...spike, y: spike.y + 4 };
        const faired = fairTrimNearPins(jagged, dragged);
        expect(faired.pins).toHaveLength(dragged.length);
        expect(faired.pins.map((p) => p.x)).toEqual(dragged.map((p) => p.x));
        for (const pin of dragged) {
            let best = Infinity;
            for (const p of faired.curve) best = Math.min(best, dist(p, pin));
            expect(best).toBeLessThanOrEqual(2.5);
        }
        const planes = contactPlanesFromLandmarks({
            heel: cast.heel,
            m1: cast.m1,
            m5: cast.m5,
            thicknessMm: 4,
        });
        const onPlate = (p: AfoVec3): AfoVec3 => {
            const h = heightAboveContact(p, planes);
            return {
                x: p.x - planes.normal.x * h,
                y: p.y - planes.normal.y * h,
                z: p.z - planes.normal.z * h,
            };
        };
        const open = openLoop(faired.curve).map(onPlate);
        let maxTurn = 0;
        for (let i = 0; i < open.length; i++) {
            const a = open[(i - 1 + open.length) % open.length]!;
            const b = open[i]!;
            const c = open[(i + 1) % open.length]!;
            const v1 = sub(b, a);
            const v2 = sub(c, b);
            const l1 = Math.hypot(v1.x, v1.y, v1.z);
            const l2 = Math.hypot(v2.x, v2.y, v2.z);
            if (l1 < 0.35 || l2 < 0.35) continue;
            const cos = Math.min(1, Math.max(-1, dot(v1, v2) / (l1 * l2)));
            maxTurn = Math.max(maxTurn, (Math.acos(cos) * 180) / Math.PI);
        }
        expect(maxTurn).toBeLessThan(25);
    });

    test("the printed plate is flat and the cut follows the smooth trim", () => {
        const cast = buildCurledAfoCast("left", 28, 12);
        const spec = { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm: 4 };
        const loop = flatPlateTrimLoop(cast.mesh, spec);
        const shell = buildAfoShell(cast.mesh, [0, 1, 2], {
            thicknessMm: 4,
            edgeMm: AFO_EDGE_MM,
            flareMm: AFO_FLARE_MM,
            trimPolygon: trimPolygonForShell(loop.curve, true) ?? undefined,
            heelSeed: cast.heel,
            flatPlate: spec,
        });
        const lock = flatPlateLockOf(shell);
        expect(lock).toBeTruthy();
        const report = validateFlatPlate(shell, lock!, AFO_EDGE_MM);
        expect(report.forefootPlanarityMm).toBeLessThanOrEqual(0.15);
        expect(report.bottomPlanarityMm).toBeLessThanOrEqual(0.2);
        expect(report.openEdges).toBe(0);
        const n = shell.outerVertex0 ?? 0;
        const up = lock!.planes.normal;
        let worst = 0;
        let counted = 0;
        const faces = (shell.indices.length / 3) | 0;
        for (let f = 0; f < faces; f++) {
            const vs = [shell.indices[f * 3] ?? 0, shell.indices[f * 3 + 1] ?? 0, shell.indices[f * 3 + 2] ?? 0];
            if (!vs.every((v) => v < n && lock!.flat[v])) continue;
            const pts = vs.map((v) => ({
                x: shell.positions[v * 3] ?? 0,
                y: shell.positions[v * 3 + 1] ?? 0,
                z: shell.positions[v * 3 + 2] ?? 0,
            }));
            const ahead = pts.every((p) => dot(sub(p, lock!.planes.m1), lock!.planes.forward) > 2);
            if (!ahead) continue;
            const e1 = sub(pts[1]!, pts[0]!);
            const e2 = sub(pts[2]!, pts[0]!);
            const nx = e1.y * e2.z - e1.z * e2.y;
            const ny = e1.z * e2.x - e1.x * e2.z;
            const nz = e1.x * e2.y - e1.y * e2.x;
            const nl = Math.hypot(nx, ny, nz) || 1;
            const align = Math.abs((nx * up.x + ny * up.y + nz * up.z) / nl);
            worst = Math.max(worst, Math.acos(Math.min(1, align)) * (180 / Math.PI));
            counted++;
        }
        expect(counted).toBeGreaterThan(20);
        expect(worst).toBeLessThan(8);
    });
});

describe("AFO cast stays an opaque solid", () => {
    test("a scan renders as a shaded mesh with side light, never a point cloud", () => {
        const cast = buildCurledAfoCast("left", 24, 12);
        const stats = afoTriangleStats(cast.mesh.positions, cast.mesh.indices);
        const style = afoCastBodyStyle({
            transparentOn: false,
            heightmap: false,
            triangleCount: stats.triangles,
            degenerateRatio: stats.degenerateRatio,
        });
        expect(style.drawMode).toBe("surface");
        expect(style.shaded).toBe(true);
        expect(style.opacity).toBe(1);
        expect(style.transparent).toBe(false);
        const geometry = afoMeshToGeometry(cast.mesh);
        const rendered = style.drawMode === "surface" ? new Mesh(geometry) : new Points(geometry);
        expect(rendered).toBeInstanceOf(Mesh);
        expect(rendered.type).not.toBe("Points");
        const camera = new Vector3(0, -280, 40);
        const matrix = new Matrix4().lookAt(camera, new Vector3(0, 0, 20), new Vector3(0, 0, 1));
        const key = afoScanLandmarkKeyLightPosition(camera, matrix);
        const view = new Vector3(0, 0, 20).sub(camera).normalize();
        const offAxis = afoScanLandmarkKeyLightOffAxisDistanceMm(camera, view, key);
        expect(offAxis).toBeGreaterThan(40);
        rendered.geometry.dispose();
    });
});
