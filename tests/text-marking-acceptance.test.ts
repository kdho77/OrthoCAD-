// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry, geometryToBinarySTL } from "@/lib/geometry/stl";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import {
    defaultTextMarking,
    TEXT_MIN_STROKE_MM,
    TEXT_U,
    TEXT_WELD_MM,
} from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { TextMarkingError } from "@/lib/geometry/text-marking/errors";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { measureTextRegionQuality } from "@/lib/geometry/text-marking/quality";
import { countSoupSelfIntersections } from "@/lib/geometry/text-marking/soup-intersect";
import type { TextApplyMeta } from "@/lib/geometry/text-marking/types";
import { assertTextMarkingInRange } from "@/lib/geometry/text-marking/validate";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, TextMarking, TextSurface } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

const SAMPLE = "JOHN SMITH 10/15";
const GATES_PY = resolve(process.cwd(), "tests/helpers/stl-gates.py");

function marking(surface: TextSurface, extras: Partial<TextMarking> = {}): TextMarking {
    return {
        ...defaultTextMarking(surface),
        text: SAMPLE,
        capHeightMm: 6,
        ...extras,
    };
}

function depthAlongNormal(
    geo: Parameters<typeof applyTextMarkingToPrintSolid>[0],
    c: { x: number; y: number; z: number },
    nOut: { x: number; y: number; z: number },
): number {
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(geo, material);
    const nlen = Math.hypot(nOut.x, nOut.y, nOut.z) || 1;
    const nx = nOut.x / nlen;
    const ny = nOut.y / nlen;
    const nz = nOut.z / nlen;
    const origin = new Vector3(c.x + nx * 8, c.y + ny * 8, c.z + nz * 8);
    const dir = new Vector3(-nx, -ny, -nz);
    const ray = new Raycaster(origin, dir, 0, 20);
    const hits = ray.intersectObject(mesh, false);
    material.dispose();
    const hit = hits[0];
    if (!hit) return Number.NaN;
    const h = hit.point;
    return (c.x - h.x) * nx + (c.y - h.y) * ny + (c.z - h.z) * nz;
}

function stlGates(stl: ArrayBuffer, tag: string): { watertight: boolean; winding: boolean; bodies: number } {
    mkdirSync("/tmp/s1-stls", { recursive: true });
    const path = `/tmp/s1-stls/text-${tag}.stl`;
    writeFileSync(path, Buffer.from(stl));
    const r = spawnSync("python3", [GATES_PY, tag, path], { encoding: "utf8" });
    const parsed = JSON.parse(r.stdout || "{}") as {
        watertight?: boolean;
        winding?: boolean;
        bodies?: number;
    };
    return {
        watertight: Boolean(parsed.watertight),
        winding: Boolean(parsed.winding),
        bodies: parsed.bodies ?? -1,
    };
}

describe("text marking negative tests (no STL)", () => {
    test("too thin, too long, bottom emboss, out of range", () => {
        expect(() => assertTextMarkingInRange({ ...defaultTextMarking(), text: "A".repeat(41) })).toThrow(
            /too long/i,
        );
        expect(() =>
            assertTextMarkingInRange({ ...defaultTextMarking(), text: SAMPLE, mode: "emboss" }),
        ).toThrow(/bottom emboss/i);
        expect(() =>
            assertTextMarkingInRange({ ...defaultTextMarking("wall"), text: SAMPLE, capHeightMm: 4 }),
        ).toThrow(/out of range/i);
        expect(() => assertTextMarkingInRange({ ...defaultTextMarking(), text: SAMPLE, depthMm: 3 })).toThrow(
            /out of range/i,
        );
    });
});

describe("text marking L/R × wall/bottom builds", () => {
    test("JOHN SMITH 10/15 at 6 mm passes gates; stroke and mapped width", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        expect(flat.minStrokeMm).toBeGreaterThanOrEqual(TEXT_MIN_STROKE_MM);

        const raw = await loadSampleTopGlb();
        const sides: Array<{ side: Side; geo: ReturnType<typeof reconstructProceduralPreview> }> = [];
        try {
            const right = reconstructProceduralPreview(raw, { wallStyle: "straight" });
            sides.push({ side: "right", geo: right });
            const mirrored = mirrorGeometry(raw);
            const left = reconstructProceduralPreview(mirrored, { wallStyle: "straight" });
            mirrored.dispose();
            sides.push({ side: "left", geo: left });
        } finally {
            raw.dispose();
        }

        const metrics: Record<string, unknown> = {};
        for (const { side, geo } of sides) {
            for (const surface of ["bottom", "wall"] as const) {
                const m = marking(surface);
                const host = geo.geometry.clone();
                const tagged = await applyTextMarkingToPrintSolid(geo.geometry.clone(), m, { side });
                const ud = tagged.userData as {
                    textMarking?: TextApplyMeta;
                    textGates?: { watertight?: boolean; gWind?: boolean; selfIntersections?: number };
                };
                expect(ud.textGates?.watertight).toBe(true);
                expect(ud.textGates?.gWind).toBe(true);
                expect(ud.textGates?.selfIntersections).toBe(0);
                if (surface === "wall") {
                    const mapped = ud.textMarking?.mappedWidthMm ?? 0;
                    expect(Math.abs(mapped - flat.advanceMm) / flat.advanceMm).toBeLessThanOrEqual(0.02);
                    expect(ud.textMarking?.wallUMin ?? -1).toBeGreaterThanOrEqual(TEXT_U.wall.min - 1e-6);
                    expect(ud.textMarking?.wallUMax ?? 99).toBeLessThanOrEqual(TEXT_U.wall.max + 1e-6);
                    const cents = ud.textMarking?.centroids ?? [];
                    expect(cents.length).toBeGreaterThan(3);
                    for (const c of cents) {
                        expect(c.u ?? -1).toBeGreaterThanOrEqual(TEXT_U.wall.min - 1e-6);
                        expect(c.u ?? 99).toBeLessThanOrEqual(TEXT_U.wall.max + 1e-6);
                    }
                    const slanted = cents.reduce((best, c) => {
                        const a = Math.abs(c.nOut?.z ?? 0);
                        const b = Math.abs(best.nOut?.z ?? 0);
                        return a > b ? c : best;
                    });
                    const along = depthAlongNormal(tagged, slanted, slanted.nOut ?? { x: 0, y: 0, z: 1 });
                    const depth = ud.textMarking?.depthMm ?? 0;
                    expect(Math.abs(along - depth)).toBeLessThanOrEqual(0.05);
                }
                if (surface === "bottom") {
                    const depth = ud.textMarking?.depthMm ?? 0;
                    for (const c of ud.textMarking?.centroids ?? []) {
                        expect(Math.abs(c.z - depth)).toBeLessThanOrEqual(0.05);
                    }
                }
                const stl = geometryToBinarySTL(tagged);
                const soup = binaryStlToGeometry(stl);
                const soupSi = countSoupSelfIntersections(soup, TEXT_WELD_MM);
                expect(soupSi.real).toBe(0);
                const q = measureTextRegionQuality(soup, host, ud.textMarking!);
                metrics[`${side}-${surface}`] = { ...q, soupSi: soupSi.real };
                mkdirSync("/tmp/s1-stls", { recursive: true });
                writeFileSync("/tmp/s1-stls/text-quality.json", JSON.stringify(metrics, null, 2));
                expect(q.outsideVertMaxMm).toBeLessThanOrEqual(1e-4);
                expect(q.outsideHostVertsMissing).toBe(0);
                expect(q.outsideTrisLost).toBe(0);
                expect(q.inRegion.pctMinAngleGe5).toBeGreaterThanOrEqual(99);
                expect(q.inRegion.minAngleMinDeg).toBeGreaterThanOrEqual(1);
                expect(q.inRegion.aspectP99).toBeLessThanOrEqual(10);
                expect(q.inRegion.aspectMax).toBeLessThanOrEqual(30);
                expect(q.inRegion.longestEdgeMm).toBeLessThanOrEqual(0.6);
                expect(q.floor.depthAbsMaxMm).toBeLessThanOrEqual(0.05);
                expect(q.floor.depthStdMm).toBeLessThanOrEqual(0.02);
                expect(q.sidewall.pctDotLe01).toBeGreaterThanOrEqual(95);
                expect(q.dihedral.floorFloorMaxDeg).toBeLessThanOrEqual(10);
                expect(q.dihedral.wallWallMaxDeg).toBeLessThanOrEqual(10);
                expect(q.outline.hausdorffMm).toBeLessThanOrEqual(0.05);
                expect(q.outline.extraTurnGt30).toBe(0);
                expect(q.triCount).toBeGreaterThanOrEqual(60_000);
                expect(q.triCount).toBeLessThanOrEqual(120_000);
                soup.dispose();
                const gate = stlGates(stl, `${side}-${surface}`);
                expect(gate.watertight).toBe(true);
                expect(gate.winding).toBe(true);
                expect(gate.bodies).toBe(1);
                tagged.dispose();
                host.dispose();
            }
            geo.geometry.dispose();
        }
        mkdirSync("/tmp/s1-stls", { recursive: true });
        writeFileSync("/tmp/s1-stls/text-quality.json", JSON.stringify(metrics, null, 2));
    }, 300_000);

    test("empty text is a no-op (same object)", async () => {
        const buf = await loadSampleTopGlb();
        try {
            const preview = reconstructProceduralPreview(buf, { wallStyle: "straight" });
            const same = await applyTextMarkingToPrintSolid(preview.geometry, defaultTextMarking(), {
                side: "right",
            });
            expect(same).toBe(preview.geometry);
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    });

    test("over-length wall string errors instead of leaving the u band", async () => {
        const buf = await loadSampleTopGlb();
        try {
            const preview = reconstructProceduralPreview(buf, { wallStyle: "straight" });
            await expect(
                applyTextMarkingToPrintSolid(
                    preview.geometry,
                    marking("wall", { text: "X".repeat(40), capHeightMm: 6 }),
                    { side: "right" },
                ),
            ).rejects.toBeInstanceOf(TextMarkingError);
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    }, 60_000);

    test("forbidden zone / thickness errors never yield a broken STL", async () => {
        const buf = await loadSampleTopGlb();
        try {
            const preview = reconstructProceduralPreview(buf, { wallStyle: "straight" });
            await expect(
                applyTextMarkingToPrintSolid(
                    preview.geometry,
                    marking("bottom", { placementU: 0.15, capHeightMm: 14, letterSpacingMm: 4 }),
                    { side: "right" },
                ),
            ).rejects.toBeInstanceOf(TextMarkingError);
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    }, 60_000);

    test("bottom flipped-render occupancy IoU >= 0.9 vs mirrored glyphs", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, SAMPLE, 6, 0.6, true);
        const buf = await loadSampleTopGlb();
        try {
            const preview = reconstructProceduralPreview(buf, { wallStyle: "straight" });
            const tagged = await applyTextMarkingToPrintSolid(preview.geometry.clone(), marking("bottom"), {
                side: "right",
            });
            const meta = (
                tagged.userData as { textMarking?: { centroids?: Array<{ x: number; y: number }> } }
            ).textMarking;
            const cents = meta?.centroids ?? [];
            expect(cents.length).toBeGreaterThan(3);
            const cy = cents.reduce((s, p) => s + p.y, 0) / cents.length;
            const placedYs = cents.map((p) => p.y - cy);
            const src = flat.centroids;
            const srcCy = src.reduce((s, p) => s + p.y, 0) / Math.max(1, src.length);
            const srcYs = src.map((p) => p.y - srcCy);
            // Pancake-flip about X (Y → −Y) undoes the bottom glyph mirror.
            let match = 0;
            const n = Math.min(placedYs.length, srcYs.length);
            for (let i = 0; i < n; i++) {
                if (Math.abs(placedYs[i]! + srcYs[i]!) < 1.2) match++;
            }
            expect(match / n).toBeGreaterThanOrEqual(0.9);
            tagged.dispose();
            preview.geometry.dispose();
        } finally {
            buf.dispose();
        }
    }, 90_000);
});
