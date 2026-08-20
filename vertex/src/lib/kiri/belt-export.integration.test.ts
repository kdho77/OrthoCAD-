// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { BoxGeometry, type BufferGeometry } from "three";
import { loadProductionDefaultGlb } from "../../../../tests/helpers/load-production-default-glb";
import { measureGcodeEnvelope } from "./belt-export";
import { BeltBoundsError, MissingToeHeelError } from "./belt-transform";
import { generateGcode } from "./engine";
import { PRINTER_PRESETS } from "./presets";
import {
    contactLoopInnerGantry,
    indexWalls,
    measureMoveSpans,
    prepareRotated,
    sliceStations,
    sliverRanges,
    widestOuterSection,
} from "./belt-r3-harness";

const apex = PRINTER_PRESETS.find((p) => p.id === "apex-belt-v2")!;
const desktop = PRINTER_PRESETS.find((p) => p.id === "desktop-fdm")!;

/** Footprint-frame box: X heel→toe 0..L, Y ML centred, Z 0..H. */
function footprintBox(length: number, width: number, height: number): BufferGeometry {
    const geo = new BoxGeometry(length, width, height);
    geo.translate(length / 2, 0, height / 2);
    return geo;
}

/** Tall at heel (min X), feathered at toe — Y_max must land late on the belt. */
function heelTallWedge(length: number, width: number, height: number): BufferGeometry {
    const geo = footprintBox(length, width, height);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setZ(i, z * (1 - 0.92 * (x / length)));
    }
    pos.needsUpdate = true;
    geo.computeBoundingBox();
    return geo;
}

function inLayerZWords(gcode: string): number {
    let inLayer = false;
    let zInside = 0;
    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        if (line.startsWith(";LAYER:")) inLayer = true;
        if (line === ";MESH:NONMESH") {
            inLayer = false;
            continue;
        }
        if (inLayer && /^G[01]\b/.test(line) && /\sZ-?\d/.test(line)) zInside++;
    }
    return zInside;
}

function parseLayerZs(gcode: string): number[] {
    const zs: number[] = [];
    const re = /^;LAYER:(\d+)/;
    let pending = false;
    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        if (re.test(line)) pending = true;
        if (pending && line === ";MESH:NONMESH") {
            pending = false;
        }
    }
    const zRe = /^G0 F600 .*Z(-?\d+(?:\.\d+)?)/;
    let afterNonmesh = false;
    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        if (line === ";MESH:NONMESH") {
            afterNonmesh = true;
            continue;
        }
        if (afterNonmesh) {
            const m = zRe.exec(line);
            if (m) zs.push(Number(m[1]));
            afterNonmesh = false;
        }
    }
    return zs;
}

function firstExtrudeEOverMm(gcode: string): { e: number; len: number } | null {
    let lastX: number | undefined;
    let lastY: number | undefined;
    let inOuter = false;
    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        if (line === ";TYPE:WALL-OUTER") inOuter = true;
        if (line.startsWith(";TYPE:") && line !== ";TYPE:WALL-OUTER") inOuter = false;
        if (!inOuter || !/^G[01]\b/.test(line)) {
            const x = /(?:^|\s)X(-?\d+(?:\.\d+)?)/.exec(line);
            const y = /(?:^|\s)Y(-?\d+(?:\.\d+)?)/.exec(line);
            if (x) lastX = Number(x[1]);
            if (y) lastY = Number(y[1]);
            continue;
        }
        const x = /(?:^|\s)X(-?\d+(?:\.\d+)?)/.exec(line);
        const y = /(?:^|\s)Y(-?\d+(?:\.\d+)?)/.exec(line);
        const e = /(?:^|\s)E(-?\d+(?:\.\d+)?)/.exec(line);
        if (x && y && e && lastX !== undefined && lastY !== undefined && line.startsWith("G1")) {
            const len = Math.hypot(Number(x[1]) - lastX, Number(y[1]) - lastY);
            if (len > 1) return { e: Number(e[1]), len };
        }
        if (x) lastX = Number(x[1]);
        if (y) lastY = Number(y[1]);
    }
    return null;
}

interface WallBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

function wallBox(gcode: string, layer: number, type: "WALL-OUTER" | "WALL-INNER"): WallBox | null {
    let cur = -1;
    let inType = false;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        const lm = /^;LAYER:(\d+)/.exec(line);
        if (lm) {
            cur = Number(lm[1]);
            inType = false;
            continue;
        }
        if (cur !== layer) continue;
        if (line.startsWith(";TYPE:")) inType = line === `;TYPE:${type}`;
        if (line === ";MESH:NONMESH") inType = false;
        if (!inType || !/^G[01]\b/.test(line)) continue;
        const x = /(?:^|\s)X(-?\d+(?:\.\d+)?)/.exec(line);
        const y = /(?:^|\s)Y(-?\d+(?:\.\d+)?)/.exec(line);
        if (x) xs.push(Number(x[1]));
        if (y) ys.push(Number(y[1]));
    }
    if (!xs.length || !ys.length) return null;
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function headerBounds(gcode: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of ["MINX", "MINY", "MINZ", "MAXX", "MAXY", "MAXZ"]) {
        const m = new RegExp(`;${key}:(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)`, "i").exec(gcode);
        if (m) out[key] = Number(m[1]);
    }
    return out;
}

function feedsOnLayer(gcode: string, layer: number): number[] {
    let cur = -1;
    const feeds: number[] = [];
    for (const raw of gcode.split("\n")) {
        const line = raw.trim();
        const lm = /^;LAYER:(\d+)/.exec(line);
        if (lm) cur = Number(lm[1]);
        if (cur !== layer) continue;
        if (line === ";MESH:NONMESH") break;
        const fm = /^G1 F(\d+)/.exec(line);
        if (fm) feeds.push(Number(fm[1]));
    }
    return feeds;
}

describe("belt export integration (R2)", () => {
    test("9 — 10×10×10 cube envelope, constant belt step, Z constant in-layer", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0.2, perimeters: 1 });
        const env = measureGcodeEnvelope(gcode);
        expect(env.hasNaN).toBe(false);
        expect(env.minZ).toBeCloseTo(0.65, 2);
        expect(env.minY).toBeGreaterThanOrEqual(-1e-6);
        expect(env.xSpan).toBeGreaterThan(8);
        expect(env.xSpan).toBeLessThan(10);
        expect(env.ySpan).toBeGreaterThan(13);
        expect(env.ySpan).toBeLessThan(15);
        expect(env.zSpan).toBeGreaterThan(18);
        expect(env.zSpan).toBeLessThan(22);
        // Planes at k·h·sinθ, k = 1..floor(sMax/h), sMax = L+H = 20. No partial final layer.
        expect(env.layerCount).toBe(Math.floor(20 / 0.65));

        const layerZs = parseLayerZs(gcode);
        const printed = layerZs.slice(0, -1);
        for (let i = 1; i < printed.length; i++) {
            expect(printed[i] - printed[i - 1]).toBeCloseTo(0.65, 5);
        }
        expect(inLayerZWords(gcode)).toBe(0);

        const contact = env.layersYMin.filter((y) => Number.isFinite(y) && Math.abs(y) <= 1e-6).length;
        expect(contact).toBeGreaterThan(0);
        let leftContact = false;
        let prevAfter = -Infinity;
        for (let i = 0; i < env.layersYMin.length; i++) {
            const y = env.layersYMin[i];
            if (!Number.isFinite(y)) continue;
            expect(y).toBeGreaterThanOrEqual(-1e-6);
            if (Math.abs(y) <= 1e-6) {
                expect(leftContact).toBe(false);
            } else {
                leftContact = true;
                expect(y).toBeGreaterThan(prevAfter);
                prevAfter = y;
            }
        }
        geo.dispose();
    });

    test("R1a — WALL-OUTER X span is 9.20 ± 0.02 on the 10 mm cube", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0, perimeters: 1 });
        const outer = wallBox(gcode, 0, "WALL-OUTER");
        expect(outer).toBeTruthy();
        if (!outer) return;
        expect(outer.maxX - outer.minX).toBeGreaterThanOrEqual(9.18);
        expect(outer.maxX - outer.minX).toBeLessThanOrEqual(9.22);
        geo.dispose();
    });

    test("R1b-i / R1b-ii — inner inset on X is 0.80; contact edge is clipped", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0, perimeters: 2 });
        const env = measureGcodeEnvelope(gcode);
        let contactLayer = -1;
        for (let i = 0; i < env.layersYMin.length; i++) {
            const y = env.layersYMin[i];
            if (!Number.isFinite(y) || Math.abs(y) > 1e-6) continue;
            const o = wallBox(gcode, i, "WALL-OUTER");
            const n = wallBox(gcode, i, "WALL-INNER");
            if (o && n) {
                contactLayer = i;
                break;
            }
        }
        expect(contactLayer).toBeGreaterThanOrEqual(0);
        const outer = wallBox(gcode, contactLayer, "WALL-OUTER");
        const inner = wallBox(gcode, contactLayer, "WALL-INNER");
        expect(outer).toBeTruthy();
        expect(inner).toBeTruthy();
        if (!outer || !inner) return;

        // R1b-i: neither X edge touches the belt.
        const insetX = Math.abs(outer.maxX - outer.minX - (inner.maxX - inner.minX)) / 2;
        expect(insetX).toBeGreaterThanOrEqual(0.795);
        expect(insetX).toBeLessThanOrEqual(0.805);

        // R1b-ii: contact edge — outer on the belt; inner off it but < lineWidth.
        expect(Math.abs(outer.minY)).toBeLessThanOrEqual(1e-6);
        expect(inner.minY).toBeGreaterThan(0);
        // Cube contact is a 90° pair: edge-offset inner sits at exactly lineWidth.
        // VOSS L0 inner Y=0.716 is a non-orthogonal insole wall, not a looser bound.
        expect(inner.minY).toBeLessThanOrEqual(0.8 + 1e-6);
        geo.dispose();
    });

    test("R1c — toolpath stays inside solid AABB + lineWidth/2 (gantry contact exempt)", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0.2, perimeters: 1 });
        const env = measureGcodeEnvelope(gcode);
        const half = 0.4;
        expect(env.minX).toBeGreaterThanOrEqual(0 - half);
        expect(env.maxX).toBeLessThanOrEqual(10 + half);
        expect(env.minY).toBeGreaterThanOrEqual(-1e-6);
        expect(env.maxY).toBeLessThanOrEqual(10 * Math.SQRT2 + half);
        geo.dispose();
    });

    test("11 — flow from machine XY matches 0.090800 mm/mm", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0.15, perimeters: 1 });
        const seg = firstExtrudeEOverMm(gcode);
        expect(seg).toBeTruthy();
        if (!seg) return;
        expect(seg.e / seg.len).toBeCloseTo(0.0908, 4);
        geo.dispose();
    });

    test("12 — preamble/postamble: PRINT_START, no G28 Z, no bare G28, no prime", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left" });
        expect(gcode.startsWith("PRINT_START")).toBe(true);
        expect(gcode).toContain(";TARGET_MACHINE.NAME:IdeaFormer Printer");
        expect(gcode).toContain(";LAYER_COUNT:");
        expect(gcode).toContain("M109 S230");
        expect(gcode).toContain("M83 ;relative extrusion mode");
        expect(gcode).toContain("PRINT_END");
        expect(gcode).toContain("G28 Y");
        expect(gcode).toContain("G28 X");
        expect(gcode).not.toMatch(/^G28\s*$/m);
        expect(gcode).not.toMatch(/G28\s+Z/);
        expect(gcode).not.toContain("M84");
        const firstG0 = gcode.split("\n").find((l) => /^G0\b/.test(l.trim()));
        expect(firstG0).toBeTruthy();
        const preamble = gcode.slice(0, gcode.indexOf(";LAYER:0"));
        expect(preamble).not.toMatch(/^G28\b/m);
        geo.dispose();
    });

    test("13 — retraction default off", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0.3, perimeters: 2 });
        const env = measureGcodeEnvelope(gcode);
        expect(env.retractCount).toBe(0);
        geo.dispose();
    });

    test("14 — min belt Z == layerHeightMm; no NaN", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left" });
        const env = measureGcodeEnvelope(gcode);
        expect(env.minZ).toBeCloseTo(0.65, 2);
        expect(env.hasNaN).toBe(false);
        geo.dispose();
    });

    test("Correction 4 — bounds, feed ramp, TYPE/MESH/M83/M204/M106 already in emitter", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0.15, perimeters: 2 });
        const env = measureGcodeEnvelope(gcode);
        const b = headerBounds(gcode);
        expect(b.MINX).toBeDefined();
        expect(b.MINY).toBeDefined();
        expect(b.MINZ).toBeDefined();
        expect(b.MAXX).toBeDefined();
        expect(b.MAXY).toBeDefined();
        expect(b.MAXZ).toBeDefined();
        for (const v of Object.values(b)) {
            expect(Number.isFinite(v)).toBe(true);
            expect(Math.abs(v)).toBeLessThan(1e5);
            expect(v).not.toBeCloseTo(2.14748e6, 0);
        }
        expect(b.MINX).toBeCloseTo(env.minX, 3);
        expect(b.MAXX).toBeCloseTo(env.maxX, 3);
        expect(b.MINY).toBeCloseTo(env.minY, 3);
        expect(b.MAXY).toBeCloseTo(env.maxY, 3);

        const f0 = feedsOnLayer(gcode, 0);
        const f1 = feedsOnLayer(gcode, 1);
        const f2 = feedsOnLayer(gcode, 2);
        expect(f0.length).toBeGreaterThan(0);
        expect(f0.every((f) => f === 600)).toBe(true);
        expect(f1.some((f) => f === 1000 || f === 1400)).toBe(true);
        expect(f1.every((f) => f === 1000 || f === 1400)).toBe(true);
        expect(f2.length).toBeGreaterThan(0);
        expect(f2.every((f) => f === 1800)).toBe(true);

        expect(gcode).toContain(";TYPE:WALL-OUTER");
        expect(gcode).toContain(";TYPE:WALL-INNER");
        expect(gcode).toMatch(/;MESH:NONMESH\nG0 F600 .*\sZ/);
        expect(gcode).toContain("M83 ;relative extrusion mode");
        expect(gcode).toContain(`;LAYER_COUNT:${env.layerCount}`);
        for (let i = 0; i < env.layerCount; i++) expect(gcode).toContain(`;LAYER:${i}`);
        expect(gcode).toContain("M204 S8000");
        expect(gcode).toContain("M204 S10000");
        expect(gcode).toContain("M204 S4000");
        expect(gcode).toMatch(/;LAYER:0\nM204 S8000\nM107/);
        expect(gcode).toMatch(/;LAYER:1\nM204 S8000\nM106 S64/);
        geo.dispose();
    });

    test("missing side hard-fails", () => {
        const geo = footprintBox(10, 10, 10);
        expect(() => generateGcode(geo, apex, {})).toThrow(MissingToeHeelError);
        geo.dispose();
    });

    test("over-width and over-height hard-fail with measured vs limit", () => {
        const wide = footprintBox(40, 400, 10);
        expect(() => generateGcode(wide, apex, { side: "left" })).toThrow(BeltBoundsError);
        try {
            generateGcode(wide, apex, { side: "left" });
        } catch (e) {
            expect(String(e)).toMatch(/400/);
            expect(String(e)).toMatch(/300/);
        }
        wide.dispose();

        const tall = footprintBox(40, 40, 180);
        expect(() => generateGcode(tall, apex, { side: "left" })).toThrow(BeltBoundsError);
        try {
            generateGcode(tall, apex, { side: "left" });
        } catch (e) {
            expect(String(e)).toMatch(/180/);
            expect(String(e)).toMatch(/sin/);
        }
        tall.dispose();
    });

    test("toe-first: global Y_max layer is in the last 30%", () => {
        const geo = heelTallWedge(40, 16, 12);
        const { gcode } = generateGcode(geo, apex, { side: "left", perimeters: 1, infillDensity: 0.1 });
        const env = measureGcodeEnvelope(gcode);
        expect(env.yMaxLayerIndex).toBeGreaterThanOrEqual(Math.floor(env.layerCount * 0.7));
        expect(env.minY).toBeGreaterThanOrEqual(-1e-6);
        let leftContact = false;
        let prevAfter = -Infinity;
        let sawContact = false;
        for (let i = 0; i < env.layersYMin.length; i++) {
            const y = env.layersYMin[i];
            if (!Number.isFinite(y)) continue;
            expect(y).toBeGreaterThanOrEqual(-1e-6);
            if (Math.abs(y) <= 1e-6) {
                expect(leftContact).toBe(false);
                sawContact = true;
            } else {
                leftContact = true;
                expect(y).toBeGreaterThan(prevAfter);
                prevAfter = y;
            }
        }
        expect(sawContact).toBe(true);
        geo.dispose();
    });

    test("LEFT and RIGHT both det-preserving toe-first exports", () => {
        const left = heelTallWedge(80, 30, 12);
        const right = heelTallWedge(80, 30, 12);
        const L = generateGcode(left, apex, { side: "left", perimeters: 1, infillDensity: 0.1 });
        const R = generateGcode(right, apex, { side: "right", perimeters: 1, infillDensity: 0.1 });
        const eL = measureGcodeEnvelope(L.gcode);
        const eR = measureGcodeEnvelope(R.gcode);
        expect(eL.hasNaN).toBe(false);
        expect(eR.hasNaN).toBe(false);
        expect(eL.minZ).toBeCloseTo(0.65, 2);
        expect(eR.minZ).toBeCloseTo(0.65, 2);
        expect(eL.xSpan).toBeCloseTo(eR.xSpan, 1);
        expect(eL.yMaxLayerIndex / eL.layerCount).toBeGreaterThan(0.7);
        expect(eR.yMaxLayerIndex / eR.layerCount).toBeGreaterThan(0.7);
        left.dispose();
        right.dispose();
    });

    test("16 — planar desktop-fdm byte-identical to Phase 0 SHA", () => {
        const geo = new BoxGeometry(10, 8, 4);
        geo.translate(5, 0, 2);
        const { gcode } = generateGcode(geo, desktop, {
            layerHeightMm: 0.2,
            infillDensity: 0.25,
            perimeters: 2,
        });
        const hash = createHash("sha256").update(gcode).digest("hex");
        expect(hash).toBe("8433469f14f5be12473494e41cb7b5d2c6f4764b6f2b00990f1655939e4c8b6a");
        geo.dispose();
    });
});

function r1dAtLayer(
    stations: ReturnType<typeof sliceStations>,
    layer: number,
    wallBox: { minX: number; maxX: number },
) {
    const st = stations.find((s) => s.layerIndex === layer);
    if (!st || !st.loops.length) return null;
    const overlap = (a: { minX: number; maxX: number }, b: { minX: number; maxX: number }) =>
        Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const candidates = st.loops.filter((l) => overlap(l, wallBox) > 0);
    const slice = (candidates.length ? candidates : st.loops).reduce((a, b) => (b.span > a.span ? b : a));
    const wallSpan = wallBox.maxX - wallBox.minX;
    return {
        layer,
        sliceMin: slice.minX,
        sliceMax: slice.maxX,
        sliceSpan: slice.span,
        unionMin: st.unionMinX,
        unionMax: st.unionMaxX,
        unionSpan: st.unionMaxX - st.unionMinX,
        wallMin: wallBox.minX,
        wallMax: wallBox.maxX,
        wallSpan,
        leftDeficit: wallBox.minX - slice.minX,
        rightDeficit: slice.maxX - wallBox.maxX,
        extentDelta: slice.span - wallSpan,
        grewCount: st.loops.filter((l) => l.grew).length,
        loopCount: st.loops.length,
        stationCount: stations.length,
        loops: st.loops.map((l) => ({
            minX: l.minX,
            maxX: l.maxX,
            span: l.span,
            verts: l.verts,
            area: l.area,
            hole: l.area < 0,
            insetSpan: l.insetSpan,
            grew: l.grew,
        })),
    };
}

function assertR1cReal(gcode: string, solid: { minX: number; maxX: number; maxY: number }) {
    const spans = measureMoveSpans(gcode);
    expect(spans.extrude.minX).toBeGreaterThanOrEqual(solid.minX - 1e-6);
    expect(spans.extrude.maxX).toBeLessThanOrEqual(solid.maxX + 1e-6);
    expect(spans.extrude.minY).toBeGreaterThanOrEqual(-1e-6);
    expect(spans.extrude.maxY).toBeLessThanOrEqual(solid.maxY + 1e-6);
}

describe("AC13 production Default.glb", () => {
    const cache: Partial<
        Record<
            "left" | "right",
            {
                gcode: string;
                env: ReturnType<typeof measureGcodeEnvelope>;
                aabb: { x: number; y: number; z: number };
                widthMm: number;
                heightMm: number;
                lengthMm: number;
                stations: ReturnType<typeof sliceStations>;
            }
        >
    > = {};

    async function runSlot(slot: "left" | "right") {
        const hit = cache[slot];
        if (hit) return hit;
        const geo = await loadProductionDefaultGlb({ slot });
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const aabb = bb
            ? { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z }
            : { x: 0, y: 0, z: 0 };
        const prep = prepareRotated(geo, apex, slot);
        const stations = sliceStations(prep.rotated, prep.pitch, 45);
        const { gcode } = generateGcode(geo, apex, { side: slot, perimeters: 2, infillDensity: 0.08 });
        const env = measureGcodeEnvelope(gcode);
        geo.dispose();
        prep.rotated.dispose();
        const row = {
            gcode,
            env,
            aabb,
            widthMm: prep.widthMm,
            heightMm: prep.heightMm,
            lengthMm: prep.lengthMm,
            stations,
        };
        cache[slot] = row;
        return row;
    }


    test("LEFT Default.glb envelope / contact / AC6", async () => {
        const { env, gcode, aabb } = await runSlot("left");
        const sin = Math.SQRT2 / 2;
        const steps = env.beltSteps.filter((s) => Math.abs(s) > 1e-4);
        const maxDev = steps.length ? Math.max(...steps.map((s) => Math.abs(s - 0.65))) : 0;
        const firstRise = env.layersYMin.findIndex((y) => Number.isFinite(y) && y > 1e-6);
        const returned =
            firstRise >= 0 &&
            env.layersYMin.slice(firstRise + 1).some((y) => Number.isFinite(y) && Math.abs(y) <= 1e-6);
        const contactCount = env.layersYMin.filter((y) => Number.isFinite(y) && Math.abs(y) <= 1e-6).length;
        const spans = measureMoveSpans(gcode);
        const Llo = env.zSpan - env.ySpan * sin;
        const Lhi = env.zSpan;
        const ac13Left = {
            layerCount: env.layerCount,
            maxDev,
            all: spans.all,
            extrude: spans.extrude,
            zSpan: env.zSpan,
            H: env.ySpan * sin,
            Lbound: [Llo, aabb.x, Lhi],
            minZ: env.minZ,
            hasNaN: env.hasNaN,
            minY: env.minY,
            aabb,
            contactCount,
            firstRise,
            returned,
            yMaxLayer: env.yMaxLayerIndex,
            yMaxPct: (100 * env.yMaxLayerIndex) / env.layerCount,
        };
        writeFileSync("/tmp/oc-belt-r3-ac13-left.json", JSON.stringify(ac13Left));
        console.log("AC13_LEFT", JSON.stringify(ac13Left));
        expect(env.hasNaN).toBe(false);
        expect(env.layerCount).toBeGreaterThan(10);
        expect(env.minZ).toBeCloseTo(0.65, 1);
        expect(env.minY).toBeGreaterThanOrEqual(-1e-6);
        expect(contactCount).toBeGreaterThan(0);
        expect(returned).toBe(false);
        expect(gcode).toContain(";MESH:insole-left");
        expect(env.yMaxLayerIndex).toBeGreaterThanOrEqual(Math.floor(env.layerCount * 0.7));
        expect(aabb.x).toBeGreaterThanOrEqual(Llo - 1e-3);
        expect(aabb.x).toBeLessThanOrEqual(Lhi + 1e-3);
        for (const s of steps) expect(Math.abs(s - 0.65)).toBeLessThan(0.02);
    });

    test("RIGHT Default.glb envelope / contact / AC6", async () => {
        const { env, gcode, aabb } = await runSlot("right");
        const sin = Math.SQRT2 / 2;
        const firstRise = env.layersYMin.findIndex((y) => Number.isFinite(y) && y > 1e-6);
        const returned =
            firstRise >= 0 &&
            env.layersYMin.slice(firstRise + 1).some((y) => Number.isFinite(y) && Math.abs(y) <= 1e-6);
        const spans = measureMoveSpans(gcode);
        const Llo = env.zSpan - env.ySpan * sin;
        const ac13Right = {
            layerCount: env.layerCount,
            all: spans.all,
            extrude: spans.extrude,
            zSpan: env.zSpan,
            H: env.ySpan * sin,
            Lbound: [Llo, aabb.x, env.zSpan],
            minZ: env.minZ,
            minY: env.minY,
            aabb,
            contactCount: env.layersYMin.filter((y) => Number.isFinite(y) && Math.abs(y) <= 1e-6).length,
            firstRise,
            returned,
            yMaxLayer: env.yMaxLayerIndex,
            yMaxPct: (100 * env.yMaxLayerIndex) / env.layerCount,
        };
        writeFileSync("/tmp/oc-belt-r3-ac13-right.json", JSON.stringify(ac13Right));
        console.log("AC13_RIGHT", JSON.stringify(ac13Right));
        expect(env.hasNaN).toBe(false);
        expect(env.minZ).toBeCloseTo(0.65, 1);
        expect(env.minY).toBeGreaterThanOrEqual(-1e-6);
        expect(returned).toBe(false);
        expect(gcode).toContain(";MESH:insole-right");
        expect(env.yMaxLayerIndex).toBeGreaterThanOrEqual(Math.floor(env.layerCount * 0.7));
        expect(aabb.x).toBeGreaterThanOrEqual(Llo - 1e-3);
        expect(aabb.x).toBeLessThanOrEqual(env.zSpan + 1e-3);
    });

    test("R1d LEFT per-layer slice vs WALL-OUTER", async () => {
        const { gcode, stations, env } = await runSlot("left");
        const walls = indexWalls(gcode);
        const widest = widestOuterSection(walls);
        expect(widest).toBeTruthy();
        if (!widest) return;
        const midLayer = Math.floor(env.layerCount * 0.45);
        const heelLayer = Math.floor(env.layerCount * 0.82);
        const midBox = walls.get(midLayer)?.outerSections.reduce((a, b) =>
            b.maxX - b.minX > a.maxX - a.minX ? b : a,
        );
        const heelBox = walls.get(heelLayer)?.outerSections.reduce((a, b) =>
            b.maxX - b.minX > a.maxX - a.minX ? b : a,
        );
        const rows = [
            r1dAtLayer(stations, widest.layer, widest.box),
            midBox ? r1dAtLayer(stations, midLayer, midBox) : null,
            heelBox ? r1dAtLayer(stations, heelLayer, heelBox) : null,
        ];
        writeFileSync("/tmp/oc-belt-r3-r1d-left.json", JSON.stringify({
            layerCount: env.layerCount,
            stationCount: stations.length,
            rows,
        }));
        console.log("R1D_LEFT", JSON.stringify(rows, null, 2));
        for (const r of rows) {
            expect(r).toBeTruthy();
            if (!r) continue;
            expect(Math.abs(r.extentDelta - 0.8)).toBeLessThanOrEqual(0.02);
        }
    });

    test("R1d RIGHT per-layer slice vs WALL-OUTER", async () => {
        const { gcode, stations, env } = await runSlot("right");
        const walls = indexWalls(gcode);
        const widest = widestOuterSection(walls);
        expect(widest).toBeTruthy();
        if (!widest) return;
        const midLayer = Math.floor(env.layerCount * 0.45);
        const heelLayer = Math.floor(env.layerCount * 0.82);
        const midBox = walls.get(midLayer)?.outerSections.reduce((a, b) =>
            b.maxX - b.minX > a.maxX - a.minX ? b : a,
        );
        const heelBox = walls.get(heelLayer)?.outerSections.reduce((a, b) =>
            b.maxX - b.minX > a.maxX - a.minX ? b : a,
        );
        const rows = [
            r1dAtLayer(stations, widest.layer, widest.box),
            midBox ? r1dAtLayer(stations, midLayer, midBox) : null,
            heelBox ? r1dAtLayer(stations, heelLayer, heelBox) : null,
        ];
        writeFileSync("/tmp/oc-belt-r3-r1d-right.json", JSON.stringify({
            layerCount: env.layerCount,
            stationCount: stations.length,
            rows,
        }));
        console.log("R1D_RIGHT", JSON.stringify(rows, null, 2));
        for (const r of rows) {
            expect(r).toBeTruthy();
            if (!r) continue;
            expect(Math.abs(r.extentDelta - 0.8)).toBeLessThanOrEqual(0.02);
        }
    });

    test("R1c-real LEFT extrude inside solid AABB", async () => {
        const { gcode, widthMm, heightMm } = await runSlot("left");
        const spans = measureMoveSpans(gcode);
        console.log("R1C_LEFT_SPANS", JSON.stringify({ spans, widthMm, heightMm }));
        assertR1cReal(gcode, { minX: 0, maxX: widthMm, maxY: heightMm / Math.sin(Math.PI / 4) });
    });

    test("R1c-real RIGHT extrude inside solid AABB", async () => {
        const { gcode, widthMm, heightMm } = await runSlot("right");
        const spans = measureMoveSpans(gcode);
        console.log("R1C_RIGHT_SPANS", JSON.stringify({ spans, widthMm, heightMm }));
        assertR1cReal(gcode, { minX: 0, maxX: widthMm, maxY: heightMm / Math.sin(Math.PI / 4) });
    });

    test("2c LEFT contact-loop inner gantry", async () => {
        const { gcode, env } = await runSlot("left");
        const walls = indexWalls(gcode);
        const mid = Math.floor(env.layerCount * 0.45);
        const hit = contactLoopInnerGantry(walls, mid);
        const pair = hit ? walls.get(hit.layer)?.pairs.find((p) => Math.abs(p.outer.minY) <= 1e-6) : null;
        writeFileSync("/tmp/oc-belt-r3-c2c-left.json", JSON.stringify({ hit, pair }));
        console.log("C2C_LEFT", JSON.stringify({ hit, pair }));
        expect(hit).toBeTruthy();
        if (!hit) return;
        expect(hit.gantry).toBeGreaterThan(0);
        expect(hit.gantry).toBeLessThan(0.8);
    });

    test("2c RIGHT contact-loop inner gantry", async () => {
        const { gcode, env } = await runSlot("right");
        const walls = indexWalls(gcode);
        const mid = Math.floor(env.layerCount * 0.45);
        const hit = contactLoopInnerGantry(walls, mid);
        const pair = hit ? walls.get(hit.layer)?.pairs.find((p) => Math.abs(p.outer.minY) <= 1e-6) : null;
        writeFileSync("/tmp/oc-belt-r3-c2c-right.json", JSON.stringify({ hit, pair }));
        console.log("C2C_RIGHT", JSON.stringify({ hit, pair }));
        expect(hit).toBeTruthy();
        if (!hit) return;
        expect(hit.gantry).toBeGreaterThan(0);
        expect(hit.gantry).toBeLessThan(0.8);
    });

    test("Task 4 sliver-drop ranges LEFT+RIGHT", async () => {
        const L = await runSlot("left");
        const R = await runSlot("right");
        const beltZ = (n: number) => 0.65 * (n + 1);
        const lw = indexWalls(L.gcode);
        const rw = indexWalls(R.gcode);
        const leftSliver = sliverRanges(lw, L.env.layerCount, beltZ);
        const rightSliver = sliverRanges(rw, R.env.layerCount, beltZ);
        let lDrop = 0;
        let rDrop = 0;
        let lMiss = 0;
        let rMiss = 0;
        for (let i = 0; i < L.env.layerCount; i++) {
            const w = lw.get(i);
            if (!w?.outer) lMiss++;
            else if (!w.inner) lDrop++;
        }
        for (let i = 0; i < R.env.layerCount; i++) {
            const w = rw.get(i);
            if (!w?.outer) rMiss++;
            else if (!w.inner) rDrop++;
        }
        writeFileSync(
            "/tmp/oc-belt-r3-sliver.json",
            JSON.stringify({
                leftRanges: leftSliver.ranges,
                rightRanges: rightSliver.ranges,
                leftDropped: leftSliver.droppedLayers,
                rightDropped: rightSliver.droppedLayers,
                lDrop,
                rDrop,
                lMiss,
                rMiss,
            }),
        );
        console.log(
            "SLIVER",
            JSON.stringify({
                leftRanges: leftSliver.ranges,
                rightRanges: rightSliver.ranges,
                leftDropped: leftSliver.droppedLayers,
                rightDropped: rightSliver.droppedLayers,
                lDrop,
                rDrop,
                lMiss,
                rMiss,
            }),
        );
        expect(lMiss).toBe(0);
        expect(rMiss).toBe(0);
    });
});

describe("R1c-real cube and wedge", () => {
    test("cube extrude inside AABB", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0.2, perimeters: 1 });
        assertR1cReal(gcode, { minX: 0, maxX: 10, maxY: 10 * Math.SQRT2 });
        geo.dispose();
    });

    test("heel-tall wedge extrude inside AABB", () => {
        const geo = heelTallWedge(40, 16, 12);
        const { gcode } = generateGcode(geo, apex, { side: "left", perimeters: 1, infillDensity: 0.1 });
        assertR1cReal(gcode, { minX: 0, maxX: 16, maxY: 12 * Math.SQRT2 });
        geo.dispose();
    });
});
