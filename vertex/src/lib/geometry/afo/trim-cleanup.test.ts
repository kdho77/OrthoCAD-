// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { getAfoState, useAfoStore } from "@/stores/afo-store";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import { defaultAfoDesignState } from "./defaults";
import { afoShellIsCurrent, currentAfoShellFingerprint } from "./shell-fingerprint";
import { buildLiveFrameLeg } from "./synthetic-leg";
import {
    applyAfoTrimCleanup,
    cleanupTrimCurve,
    TRIM_CLEANUP_MAX_DEVIATION_MM,
    TRIM_CLEANUP_PROTECTED_DEVIATION_MM,
    trimCurveDeviation,
    trimProtectedAnchors,
    validateTrimCleanup,
} from "./trim-cleanup";
import { loopNearZ } from "./trim-loop";
import type { AfoTriMesh, AfoVec3 } from "./types";

function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function plane(min: number, max: number, cells: number): AfoTriMesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const row = cells + 1;
    for (let iy = 0; iy <= cells; iy++) {
        for (let ix = 0; ix <= cells; ix++) {
            positions.push(min + ((max - min) * ix) / cells, min + ((max - min) * iy) / cells, 0);
        }
    }
    for (let iy = 0; iy < cells; iy++) {
        for (let ix = 0; ix < cells; ix++) {
            const i = iy * row + ix;
            indices.push(i, i + 1, i + row, i + 1, i + row + 1, i + row);
        }
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function circle(radius: number, count: number): AfoVec3[] {
    const points: AfoVec3[] = [];
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        points.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, z: 0 });
    }
    return points;
}

function at(mesh: AfoTriMesh, index: number): AfoVec3 {
    return {
        x: mesh.positions[index * 3] ?? 0,
        y: mesh.positions[index * 3 + 1] ?? 0,
        z: mesh.positions[index * 3 + 2] ?? 0,
    };
}

describe("AFO trim cleanup", () => {
    test("keeps protected points and endpoints, and may use more than 48 dots", () => {
        const mesh = plane(-200, 200, 8);
        const pins = circle(110, 80);
        const anchor = pins[10]!;
        const result = cleanupTrimCurve({
            mesh,
            pins,
            curve: pins,
            closed: true,
            anchors: [anchor],
        });
        expect(result.ok).toBe(true);
        expect(result.pins.length).toBeGreaterThan(48);
        expect(result.pins.some((point) => dist(point, anchor) <= 1e-4)).toBe(true);
        expect(trimCurveDeviation(result.pins, pins, true)).toBeLessThanOrEqual(
            TRIM_CLEANUP_MAX_DEVIATION_MM + 1e-3,
        );

        const open: AfoVec3[] = [];
        for (let x = 0; x <= 180; x += 4) open.push({ x, y: x % 12 === 0 ? 0.6 : 0, z: 0 });
        const opened = cleanupTrimCurve({ mesh, pins: open, curve: open, closed: false, anchors: [] });
        expect(opened.ok).toBe(true);
        expect(opened.pins[0]).toEqual(open[0]);
        expect(opened.pins[opened.pins.length - 1]).toEqual(open[open.length - 1]);
        expect(trimCurveDeviation(opened.pins, open, false)).toBeLessThanOrEqual(
            TRIM_CLEANUP_MAX_DEVIATION_MM + 1e-3,
        );
    });

    test("a shortcut past the deviation limit is rejected and the original dots stay", () => {
        const mesh = plane(-40, 40, 6);
        const original: AfoVec3[] = [];
        for (let x = -20; x <= 20; x += 2) {
            const bump = Math.abs(x) <= 8 ? Math.sqrt(Math.max(0, 64 - x * x)) : 0;
            original.push({ x, y: bump, z: 0 });
        }
        const shortcut = [original[0]!, { x: 20, y: 0, z: 0 }];
        const reasons = validateTrimCleanup({
            mesh,
            original,
            candidate: shortcut,
            closed: false,
            protectedPins: [original[0]!, original[original.length - 1]!],
            endpoints: [original[0]!, original[original.length - 1]!],
        });
        expect(reasons.some((reason) => reason.includes("moved the curve"))).toBe(true);
        expect(trimCurveDeviation(shortcut, original, false)).toBeGreaterThan(TRIM_CLEANUP_MAX_DEVIATION_MM);

        const cleaned = cleanupTrimCurve({ mesh, pins: original, curve: original, closed: false });
        expect(trimCurveDeviation(cleaned.pins, original, false)).toBeLessThanOrEqual(
            TRIM_CLEANUP_MAX_DEVIATION_MM + 1e-3,
        );
        const apex = original.find((point) => point.x === 0);
        expect(apex).toBeDefined();
        if (apex) {
            let nearest = Infinity;
            const kept = cleaned.pins;
            for (let i = 0; i < kept.length - 1; i++) {
                const a = kept[i];
                const b = kept[i + 1];
                if (!a || !b) continue;
                const abx = b.x - a.x;
                const aby = b.y - a.y;
                const ab2 = abx * abx + aby * aby || 1;
                const t = Math.min(1, Math.max(0, ((apex.x - a.x) * abx + (apex.y - a.y) * aby) / ab2));
                nearest = Math.min(nearest, Math.hypot(apex.x - (a.x + abx * t), apex.y - (a.y + aby * t)));
            }
            expect(nearest).toBeLessThanOrEqual(TRIM_CLEANUP_MAX_DEVIATION_MM + 1e-3);
        }

        const crossing = [
            { x: 0, y: 0, z: 0 },
            { x: 20, y: 20, z: 0 },
            { x: 20, y: 0, z: 0 },
            { x: 0, y: 20, z: 0 },
        ];
        const failed = cleanupTrimCurve({ mesh, pins: crossing, curve: crossing, closed: true });
        expect(failed.ok).toBe(false);
        expect(failed.applied).toBe(false);
        expect(failed.pins).toEqual(crossing);
    });

    test("protected landmarks stay inside 1 mm and a failed cleanup does not undo-step", () => {
        const mesh = plane(-40, 40, 4);
        const pins = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 },
            { x: 10, y: 10, z: 0 },
            { x: 0, y: 10, z: 0 },
        ];
        const moved = pins.map((point, index) => (index === 1 ? { x: 12, y: 2, z: 0 } : point));
        const reasons = validateTrimCleanup({
            mesh,
            original: pins,
            candidate: moved,
            closed: true,
            protectedPins: [pins[1]!],
            endpoints: [],
        });
        expect(reasons.some((reason) => reason.includes("protected"))).toBe(true);
        expect(TRIM_CLEANUP_PROTECTED_DEVIATION_MM).toBe(1);

        useAfoStore.getState().resetSession();
        useAfoStore.getState().setCastMesh(mesh);
        useDesignStore.setState({
            design: {
                ...defaultDesign(),
                productType: "afo",
                method: "printing_shell",
                afo: {
                    ...defaultAfoDesignState("left"),
                    trimPoints: pins.map((point, vertexIndex) => ({ point, vertexIndex })),
                    trimCurve: pins,
                    trimClosed: true,
                    trimConfirmed: true,
                    shellReady: true,
                    landmarks: [{ id: "malleolus_medial", point: pins[0]!, vertexIndex: 0 }],
                },
            },
            history: [],
            future: [],
        });
        const crossing = [
            { x: 0, y: 0, z: 0 },
            { x: 20, y: 20, z: 0 },
            { x: 20, y: 0, z: 0 },
            { x: 0, y: 20, z: 0 },
        ];
        const malleolus = crossing[0] ?? { x: 0, y: 0, z: 0 };
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                afo: {
                    ...getAfoState(),
                    trimPoints: crossing.map((point, vertexIndex) => ({ point, vertexIndex })),
                    trimCurve: crossing,
                    landmarks: [{ id: "malleolus_medial", point: malleolus, vertexIndex: 0 }],
                    shellReady: true,
                },
            },
        });
        useAfoStore.getState().commitShell(mesh, currentAfoShellFingerprint());
        expect(trimProtectedAnchors(getAfoState()).some((point) => dist(point, malleolus) < 1e-6)).toBe(true);
        expect(afoShellIsCurrent()).toBe(true);
        const rejected = applyAfoTrimCleanup();
        expect(rejected.ok).toBe(false);
        expect(useDesignStore.getState().history).toHaveLength(0);
        expect(getAfoState().trimPoints.map((point) => point.point)).toEqual(crossing);
        expect(afoShellIsCurrent()).toBe(true);

        const dense = circle(15, 40);
        const anchor = dense[0] ?? malleolus;
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                afo: {
                    ...getAfoState(),
                    trimPoints: dense.map((point, vertexIndex) => ({ point, vertexIndex })),
                    trimCurve: dense,
                    trimClosed: true,
                    shellReady: true,
                    landmarks: [{ id: "malleolus_medial", point: anchor, vertexIndex: 0 }],
                },
            },
            history: [],
            future: [],
        });
        useAfoStore.getState().commitShell(mesh, currentAfoShellFingerprint());
        const before = getAfoState().trimPoints.map((point) => point.point);
        const applied = applyAfoTrimCleanup();
        expect(applied.ok).toBe(true);
        expect(useDesignStore.getState().history).toHaveLength(1);
        expect(getAfoState().shellReady).toBe(false);
        expect(afoShellIsCurrent()).toBe(false);
        expect(getAfoState().trimPoints.some((point) => dist(point.point, anchor) <= 1e-4)).toBe(true);
        useDesignStore.getState().undo();
        expect(getAfoState().trimPoints.map((point) => point.point)).toEqual(before);
        expect(getAfoState().shellReady).toBe(true);
        expect(afoShellIsCurrent()).toBe(true);
    });

    test("live left and right frame casts keep a brace loop on the surface", () => {
        for (const side of ["left", "right"] as const) {
            const mesh = buildLiveFrameLeg(side, 8);
            const ids = loopNearZ(mesh, 90, 24);
            expect(ids.length).toBeGreaterThanOrEqual(3);
            const pins = ids.map((index) => at(mesh, index));
            const result = cleanupTrimCurve({
                mesh,
                pins,
                curve: pins,
                closed: true,
                anchors: [pins[0]!],
            });
            const kept = result.ok ? result.pins : result.pins;
            expect(kept.some((point) => dist(point, pins[0]!) <= TRIM_CLEANUP_PROTECTED_DEVIATION_MM)).toBe(
                true,
            );
            if (result.ok) {
                expect(trimCurveDeviation(result.pins, pins, true)).toBeLessThanOrEqual(
                    TRIM_CLEANUP_MAX_DEVIATION_MM + 1e-3,
                );
            } else {
                expect(result.pins).toEqual(pins);
            }
        }
    });
});
