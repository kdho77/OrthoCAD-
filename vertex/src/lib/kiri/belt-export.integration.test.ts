// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { describe, expect, test } from "@rstest/core";
import { BoxGeometry, BufferGeometry } from "three";
import { generateGcode } from "./engine";
import { measureGcodeEnvelope } from "./belt-export";
import { BeltBoundsError, MissingToeHeelError } from "./belt-transform";
import { PRINTER_PRESETS } from "./presets";

const apex = PRINTER_PRESETS.find((p) => p.id === "apex-belt-v2")!;
const desktop = PRINTER_PRESETS.find((p) => p.id === "desktop-fdm")!;

/** Footprint-frame box: X heel→toe 0..L, Y ML centred, Z 0..H. */
function footprintBox(length: number, width: number, height: number): BufferGeometry {
    const geo = new BoxGeometry(length, width, height);
    geo.translate(length / 2, 0, height / 2);
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

describe("belt export integration (R2)", () => {
    test("9 — 10×10×10 cube envelope, constant belt step, Z constant in-layer", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0.2, perimeters: 1 });
        const env = measureGcodeEnvelope(gcode);
        expect(env.hasNaN).toBe(false);
        expect(env.minZ).toBeCloseTo(0.65, 2);
        expect(env.xSpan).toBeGreaterThan(8);
        expect(env.xSpan).toBeLessThan(11);
        expect(env.ySpan).toBeGreaterThan(13);
        expect(env.ySpan).toBeLessThan(15);
        expect(env.zSpan).toBeGreaterThan(18);
        expect(env.zSpan).toBeLessThan(22);
        const expectedLayers = Math.ceil(20 / 0.65);
        expect(env.layerCount).toBeGreaterThanOrEqual(expectedLayers - 2);
        expect(env.layerCount).toBeLessThanOrEqual(expectedLayers + 1);

        const layerZs = parseLayerZs(gcode);
        const printed = layerZs.slice(0, -1);
        for (let i = 1; i < printed.length; i++) {
            expect(printed[i] - printed[i - 1]).toBeCloseTo(0.65, 5);
        }
        expect(inLayerZWords(gcode)).toBe(0);

        const contact = env.layersYMin.filter((y) => Number.isFinite(y) && Math.abs(y) < 0.05).length;
        expect(contact).toBeGreaterThan(0);
        let leftContact = false;
        for (let i = 0; i < env.layersYMin.length; i++) {
            const y = env.layersYMin[i];
            if (!Number.isFinite(y)) continue;
            if (Math.abs(y) < 0.05) {
                expect(leftContact).toBe(false);
            } else if (i > 0) {
                leftContact = true;
                expect(y).toBeGreaterThan(0);
            }
        }
        geo.dispose();
    });

    test("11 — flow from machine XY matches 0.090800 mm/mm", () => {
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left", infillDensity: 0.15, perimeters: 1 });
        const seg = firstExtrudeEOverMm(gcode);
        expect(seg).toBeTruthy();
        expect(seg!.e / seg!.len).toBeCloseTo(0.0908, 4);
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
        const geo = footprintBox(10, 10, 10);
        const { gcode } = generateGcode(geo, apex, { side: "left" });
        const env = measureGcodeEnvelope(gcode);
        expect(env.yMaxLayerIndex).toBeGreaterThanOrEqual(Math.floor(env.layerCount * 0.7));
        geo.dispose();
    });

    test("LEFT and RIGHT both det-preserving toe-first exports", () => {
        const left = footprintBox(80, 30, 12);
        const right = footprintBox(80, 30, 12);
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

describe("AC13 synthetic insole-scale solids", () => {
    function runSide(side: "left" | "right") {
        const geo = footprintBox(200, 90, 26);
        const { gcode } = generateGcode(geo, apex, { side, perimeters: 1, infillDensity: 0.08 });
        const env = measureGcodeEnvelope(gcode);
        geo.dispose();
        return { gcode, env };
    }

    test("LEFT insole-scale measurements", () => {
        const { env } = runSide("left");
        expect(env.hasNaN).toBe(false);
        expect(env.layerCount).toBeGreaterThan(10);
        const steps = env.beltSteps.filter((s) => Math.abs(s) > 1e-4);
        for (const s of steps) {
            expect(Math.abs(s - 0.65)).toBeLessThan(0.02);
        }
        expect(env.xSpan).toBeGreaterThan(80);
        expect(env.xSpan).toBeLessThan(95);
        expect(env.minZ).toBeCloseTo(0.65, 1);
        expect(env.layersYMin.filter((y) => Math.abs(y) < 0.08).length).toBeGreaterThan(0);
    });

    test("RIGHT insole-scale measurements", () => {
        const { env } = runSide("right");
        expect(env.hasNaN).toBe(false);
        expect(env.layerCount).toBeGreaterThan(10);
        expect(env.xSpan).toBeGreaterThan(80);
        expect(env.minZ).toBeCloseTo(0.65, 1);
    });
});
