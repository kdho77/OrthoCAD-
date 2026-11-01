// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    hasMaxRiseWarning,
    hasPostingAngleWarning,
    hasShoeCounterHeightWarning,
    MAX_RISE_WARN_MM,
} from "@/lib/geometry/clinical-constraints";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import { getBaseFootprintFrame } from "./base-modifier";
import {
    buildWedgeStations,
    cupHeightAboveHeelMm,
    FULL_LENGTH_HEEL_U,
    FULL_LENGTH_TOE_FAIR_LEAD,
    FULL_LENGTH_TOE_FAIR_SPAN,
    fallbackRimXY,
    fullLengthDegFromMm,
    fullLengthDeltaFromField,
    fullLengthMmFromDeg,
    fullLengthToeSampleU,
    fullLengthWedgeDeltaAt,
    highEdgeRiseAt,
    type RimXY,
    type WedgeStations,
} from "./full-length-wedge";
import { type HeightFieldParams, heightAt, outlineHalfWidth } from "./height-field";
import { analyzeManifold } from "./manifold";
import {
    migrateSideCorrections,
    STANDARD_FOREFOOT_WEDGE,
    STANDARD_REARFOOT_WEDGE,
} from "./migrate-corrections";
import { countSelfIntersections } from "./procedural-wall/intersect";
import type { ProceduralWallStyle } from "./procedural-wall/modifiers";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "./shoe-size";
import { geometryToBinarySTL } from "./stl";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const US = [0.2, 0.5, 0.75, 0.9];
const STYLES: ProceduralWallStyle[] = ["straight", "round", "hybrid"];

function blank(patch: Partial<SideCorrections> = {}): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
        ...patch,
    };
}

function fieldFor(
    side: Side,
    corrections: SideCorrections,
    lengthMm: number,
    widthMm: number,
    extra: Partial<HeightFieldParams> = {},
): HeightFieldParams {
    return {
        side,
        lengthMm,
        widthMm,
        thicknessMm: 3,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
        ...extra,
    };
}

function rimFor(lengthMm: number, widthMm: number): RimXY[] {
    return fallbackRimXY(lengthMm, (u) => outlineHalfWidth(u) * (widthMm / 2));
}

function stationsFor(
    side: Side,
    corrections: SideCorrections,
    lengthMm: number,
    widthMm: number,
    rim: RimXY[] = rimFor(lengthMm, widthMm),
): WedgeStations {
    const stations = buildWedgeStations(rim, side, corrections.fullLengthWedge, {
        originX: 0,
        lengthMm,
        medialPositiveY: side === "left",
        ordered: true,
    });
    if (!stations) throw new Error("expected full-length stations");
    return stations;
}

describe("full-length wedge", () => {
    test("degrees round-trip through millimetres within 1e-6", () => {
        const width = 73.2;
        for (const deg of [1, 5, 6.5, 10]) {
            const back = fullLengthDegFromMm(fullLengthMmFromDeg(deg, width), width);
            expect(Math.abs(back - deg)).toBeLessThanOrEqual(1e-6);
        }
    });

    test("omitted amount is 3.0 mm at the heel high edge", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const corrections = blank({ fullLengthWedge: { side: "lateral" } });
        const stations = stationsFor("right", corrections, layout.lengthMm, layout.widthMm);
        expect(Math.abs(highEdgeRiseAt(stations, FULL_LENGTH_HEEL_U) - 3)).toBeLessThanOrEqual(0.05);
    });

    test("millimetre input matches the heel high edge within 0.05 mm", () => {
        const layout = insoleLayoutForUsMenSize(9);
        for (const mm of [1, 4, 8]) {
            const corrections = blank({ fullLengthWedge: { side: "medial", value: mm, unit: "mm" } });
            const stations = stationsFor("left", corrections, layout.lengthMm, layout.widthMm);
            expect(Math.abs(highEdgeRiseAt(stations, FULL_LENGTH_HEEL_U) - mm)).toBeLessThanOrEqual(0.05);
        }
    });

    test("ruled rise matches W·tan(θ) and the low edge stays down", () => {
        const degrees = [1, 5, 10];
        const sizes = [1, 9, 16];
        const sides: Side[] = ["left", "right"];
        const edges = ["medial", "lateral"] as const;
        for (const deg of degrees) {
            for (const size of sizes) {
                const layout = insoleLayoutForUsMenSize(size);
                for (const side of sides) {
                    for (const edge of edges) {
                        const corrections = blank({
                            fullLengthWedge: { side: edge, value: deg, unit: "deg" },
                        });
                        const stations = stationsFor(side, corrections, layout.lengthMm, layout.widthMm);
                        const params = fieldFor(side, corrections, layout.lengthMm, layout.widthMm);
                        const vHigh = stations.highPositiveY ? 1 : -1;
                        for (const u of US) {
                            const half = outlineHalfWidth(u) * (layout.widthMm / 2);
                            const expected = half * 2 * Math.tan(stations.theta);
                            const rise = highEdgeRiseAt(stations, u);
                            expect(Math.abs(rise - expected)).toBeLessThanOrEqual(0.1);
                            const dzHigh = fullLengthDeltaFromField(
                                u,
                                vHigh,
                                params,
                                (uu) => outlineHalfWidth(uu) * (layout.widthMm / 2),
                            );
                            const dzLow = fullLengthDeltaFromField(
                                u,
                                -vHigh,
                                params,
                                (uu) => outlineHalfWidth(uu) * (layout.widthMm / 2),
                            );
                            expect(Math.abs(dzHigh - dzLow - rise)).toBeLessThanOrEqual(0.1);
                            expect(dzLow).toBeLessThanOrEqual(0.05);
                            const x = u * layout.lengthMm;
                            const yLow = -vHigh * half;
                            expect(fullLengthWedgeDeltaAt(x, yLow, stations)).toBeLessThanOrEqual(0.05);
                        }
                    }
                }
            }
        }
    });

    test("value 0 matches the wedge omitted, including with a regional wedge", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const regional = blank({ rearfootWedge: { side: "lateral", value: 4, unit: "deg" } });
        const off = blank({
            ...regional,
            fullLengthWedge: { side: "lateral", value: 0, unit: "mm" },
        });
        const bare = fieldFor("right", regional, layout.lengthMm, layout.widthMm);
        const zero = fieldFor("right", off, layout.lengthMm, layout.widthMm);
        for (const u of [0.1, 0.5, 0.9]) {
            for (const v of [-0.9, 0, 0.9]) {
                expect(heightAt(u, v, zero)).toBe(heightAt(u, v, bare));
            }
        }
    });

    test("a regional wedge plus full-length equals the sum of each term", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const regional = blank({ rearfootWedge: { side: "medial", value: 4, unit: "deg" } });
        const fl = blank({ fullLengthWedge: { side: "lateral", value: 5, unit: "deg" } });
        const both = blank({
            rearfootWedge: regional.rearfootWedge,
            fullLengthWedge: fl.fullLengthWedge,
        });
        const fR = fieldFor("right", regional, layout.lengthMm, layout.widthMm);
        const fF = fieldFor("right", fl, layout.lengthMm, layout.widthMm);
        const fB = fieldFor("right", both, layout.lengthMm, layout.widthMm);
        const f0 = fieldFor("right", blank(), layout.lengthMm, layout.widthMm);
        for (const u of [0.12, 0.4, 0.7]) {
            for (const v of [-0.8, 0.2, 0.8]) {
                const sum =
                    heightAt(u, v, fR) - heightAt(u, v, f0) + (heightAt(u, v, fF) - heightAt(u, v, f0));
                const got = heightAt(u, v, fB) - heightAt(u, v, f0);
                expect(Math.abs(got - sum)).toBeLessThanOrEqual(1e-6);
            }
        }
    });

    test("standard 3 mm / 1.5 mm wedges turn off only while full-length is active", () => {
        const on = migrateSideCorrections(
            blank({
                rearfootWedge: { ...STANDARD_REARFOOT_WEDGE },
                forefootWedge: { ...STANDARD_FOREFOOT_WEDGE },
                fullLengthWedge: { side: "lateral", value: 3, unit: "mm" },
            }),
        );
        expect(on.rearfootWedge).toBeUndefined();
        expect(on.forefootWedge).toBeUndefined();
        const kept = migrateSideCorrections(
            blank({
                rearfootWedge: { side: "lateral", value: 4, unit: "deg" },
                fullLengthWedge: { side: "medial", value: 5, unit: "deg" },
            }),
        );
        expect(kept.rearfootWedge).toEqual({ side: "lateral", value: 4, unit: "deg" });
        const off = migrateSideCorrections(
            blank({
                rearfootWedge: { ...STANDARD_REARFOOT_WEDGE },
                fullLengthWedge: { side: "lateral", value: 0, unit: "mm" },
            }),
        );
        expect(off.rearfootWedge).toEqual(STANDARD_REARFOOT_WEDGE);
    });

    test("cup height above the low heel stays within 0.05 mm on both sides", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const u = 0.12;
        for (const side of ["left", "right"] as const) {
            for (const edge of ["medial", "lateral"] as const) {
                const wedgedC = blank({ fullLengthWedge: { side: edge, value: 5, unit: "deg" } });
                const wedged = fieldFor(side, wedgedC, layout.lengthMm, layout.widthMm);
                const plain = fieldFor(side, blank(), layout.lengthMm, layout.widthMm);
                const stations = stationsFor(side, wedgedC, layout.lengthMm, layout.widthMm);
                const vHigh = stations.highPositiveY ? 0.98 : -0.98;
                const vLow = -vHigh;
                const half = (uu: number) => outlineHalfWidth(uu) * (layout.widthMm / 2);
                const riseAt = (v: number) => fullLengthDeltaFromField(u, v, wedged, half);
                for (const vRim of [vHigh, vLow]) {
                    const cupW = cupHeightAboveHeelMm(
                        heightAt(u, vRim, wedged),
                        riseAt(vRim),
                        heightAt(u, vLow, wedged),
                        riseAt(vLow),
                    );
                    const cup0 = heightAt(u, vRim, plain) - heightAt(u, vLow, plain);
                    expect(Math.abs(cupW - cup0)).toBeLessThanOrEqual(0.05);
                }
                const outside = heightAt(u, vHigh, wedged) - heightAt(u, vHigh, plain);
                expect(Math.abs(outside - highEdgeRiseAt(stations, u))).toBeLessThanOrEqual(0.1);
            }
        }
    });

    test("low-side toe stays at least 3.0 mm", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const corrections = blank({ fullLengthWedge: { side: "lateral", value: 10, unit: "deg" } });
        const params = fieldFor("right", corrections, layout.lengthMm, layout.widthMm);
        const stations = stationsFor("right", corrections, layout.lengthMm, layout.widthMm);
        const vLow = stations.highPositiveY ? -0.98 : 0.98;
        expect(heightAt(0.97, vLow, params)).toBeGreaterThanOrEqual(3);
    });

    test("a 3/4 rim posts nothing past the cut, and the skive is still applied", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const length = layout.lengthMm;
        const halfAt = (u: number) => outlineHalfWidth(u) * (layout.widthMm / 2);
        const rim: RimXY[] = [];
        const n = 32;
        for (let i = 0; i <= n; i++) {
            const u = (i / n) * 0.75;
            rim.push({ x: u * length, y: halfAt(u) });
        }
        for (let i = n; i >= 0; i--) {
            const u = (i / n) * 0.75;
            rim.push({ x: u * length, y: -halfAt(u) });
        }
        const corrections = blank({
            medialSkiveMm: 4,
            fullLengthWedge: { side: "lateral", value: 5, unit: "deg" },
        });
        const frame = {
            points: rim,
            originX: 0,
            lengthMm: length,
            medialPositiveY: false,
            ordered: true,
        };
        const posted = fieldFor("right", corrections, length, layout.widthMm, {
            includeSkives: true,
            fullLengthRim: frame,
        });
        const noSkive = fieldFor("right", corrections, length, layout.widthMm, {
            includeSkives: false,
            fullLengthRim: frame,
        });
        expect(fullLengthDeltaFromField(0.9, 1, posted, halfAt)).toBe(0);
        const raise = heightAt(0.08, -0.7, posted) - heightAt(0.08, -0.7, noSkive);
        expect(raise).toBeGreaterThan(0.2);
    });

    test("met pad height above the wedged surface matches the unwedged pad", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const el: PlacedElement = {
            id: "met",
            kind: "met_pad",
            side: "right",
            position: { x: 40, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 3,
        };
        const u = (layout.lengthMm / 2 + el.position.x) / layout.lengthMm;
        const fl = blank({ fullLengthWedge: { side: "lateral", value: 5, unit: "deg" } });
        const withEl = fieldFor("right", fl, layout.lengthMm, layout.widthMm, {
            elements: [el],
            includeElements: true,
        });
        const noEl = fieldFor("right", fl, layout.lengthMm, layout.widthMm, { includeElements: false });
        const withEl0 = fieldFor("right", blank(), layout.lengthMm, layout.widthMm, {
            elements: [el],
            includeElements: true,
        });
        const noEl0 = fieldFor("right", blank(), layout.lengthMm, layout.widthMm, { includeElements: false });
        const wedged = heightAt(u, 0, withEl) - heightAt(u, 0, noEl);
        const plain = heightAt(u, 0, withEl0) - heightAt(u, 0, noEl0);
        expect(Math.abs(wedged - plain)).toBeLessThanOrEqual(0.05);
    });

    test("max-rise warning fires above 12 mm and the posting and shoe-counter warnings stay", () => {
        const length = 260;
        const rim = fallbackRimXY(length, () => 50);
        const stations = buildWedgeStations(
            rim,
            "right",
            { side: "lateral", value: 10, unit: "deg" },
            { originX: 0, lengthMm: length, medialPositiveY: false, ordered: true },
        );
        expect(stations).not.toBeNull();
        expect(stations!.maxRiseMm).toBeGreaterThan(MAX_RISE_WARN_MM);
        expect(hasMaxRiseWarning(stations!.maxRiseMm)).toBe(true);
        expect(hasMaxRiseWarning(MAX_RISE_WARN_MM)).toBe(false);

        const steep = blank({ fullLengthWedge: { side: "lateral", value: 9, unit: "deg" } });
        expect(hasPostingAngleWarning(steep)).toBe(true);
        const regional = blank({ rearfootWedge: { side: "lateral", value: 9, unit: "deg" } });
        expect(hasPostingAngleWarning(regional)).toBe(true);
        expect(hasPostingAngleWarning(blank())).toBe(false);
        // 16 mm across a 100 mm width is atan(0.16) ≈ 9.09°. The stored unit stays mm.
        const mmSteep = blank({ fullLengthWedge: { side: "lateral", value: 16, unit: "mm" } });
        const mmDeg = fullLengthDegFromMm(16, 100);
        expect(mmDeg).toBeGreaterThan(8);
        expect(hasPostingAngleWarning(mmSteep)).toBe(false);
        expect(hasPostingAngleWarning(mmSteep, mmDeg)).toBe(true);
        expect(hasPostingAngleWarning(mmSteep, 7)).toBe(false);

        expect(hasShoeCounterHeightWarning(steep, 9)).toBe(true);
        expect(hasShoeCounterHeightWarning(steep, 7)).toBe(false);
        expect(hasShoeCounterHeightWarning(blank({ heelCupHeightMm: 0 }), 0)).toBe(false);
    });

    test("a forefoot width hold freezes the toe tilt on the held station", () => {
        const layout = insoleLayoutForUsMenSize(9);
        const corrections = blank({ fullLengthWedge: { side: "lateral", value: 5, unit: "deg" } });
        const half = (u: number) => outlineHalfWidth(u) * (layout.widthMm / 2);
        const stations = stationsFor("right", corrections, layout.lengthMm, layout.widthMm);
        const open = fieldFor("right", corrections, layout.lengthMm, layout.widthMm);
        const held = fieldFor("right", corrections, layout.lengthMm, layout.widthMm, {
            fullLengthToeHoldU: 0.985,
        });
        const xOf = (u: number) => u * layout.lengthMm;
        const hold = 0.985;
        const u1 = hold - FULL_LENGTH_TOE_FAIR_LEAD;
        const u0 = u1 - FULL_LENGTH_TOE_FAIR_SPAN;
        expect(fullLengthToeSampleU(0.5, hold)).toBeCloseTo(0.5, 12);
        expect(fullLengthToeSampleU(u0, hold)).toBeCloseTo(u0, 12);
        expect(fullLengthToeSampleU(u1, hold)).toBeCloseTo(hold, 12);
        expect(fullLengthToeSampleU(1, hold)).toBeCloseTo(hold, 12);
        expect(fullLengthWedgeDeltaAt(xOf(0.5), half(0.5), stations, hold)).toBeCloseTo(
            fullLengthWedgeDeltaAt(xOf(0.5), half(0.5), stations),
            9,
        );
        // Past the lead, the point keeps its own y and the station at the hold.
        expect(fullLengthWedgeDeltaAt(xOf(1), half(1), stations, hold)).toBeCloseTo(
            fullLengthWedgeDeltaAt(xOf(hold), half(1), stations),
            9,
        );
        // The fallback toe is already flat by the hold. An earlier hold still moves the tip.
        expect(
            Math.abs(
                fullLengthWedgeDeltaAt(xOf(1), half(1), stations) -
                    fullLengthWedgeDeltaAt(xOf(1), half(1), stations, 0.9),
            ),
        ).toBeGreaterThan(1e-3);
        expect(fullLengthDeltaFromField(1, 1, held, half)).toBeCloseTo(
            fullLengthWedgeDeltaAt(xOf(0.985), half(1), stations),
            9,
        );
        expect(fullLengthDeltaFromField(0.5, 1, held, half)).toBeCloseTo(
            fullLengthDeltaFromField(0.5, 1, open, half),
            9,
        );
    });
});

function stlMd5(geo: BufferGeometry): string {
    return createHash("md5")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

function eulerOf(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!index) return 0;
    const q = 1e4;
    const map = new Map<string, number>();
    const vid = (i: number) => {
        const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
        let id = map.get(k);
        if (id === undefined) {
            id = map.size;
            map.set(k, id);
        }
        return id;
    };
    const edges = new Set<string>();
    const faces = index.count / 3;
    const ek = (p: number, qv: number) => (p < qv ? `${p}|${qv}` : `${qv}|${p}`);
    for (let t = 0; t < faces; t++) {
        const a = vid(index.getX(t * 3));
        const b = vid(index.getX(t * 3 + 1));
        const c = vid(index.getX(t * 3 + 2));
        edges.add(ek(a, b));
        edges.add(ek(b, c));
        edges.add(ek(c, a));
    }
    return map.size - edges.size + faces;
}

/** Position-welded wall dihedral. Both faces |nz|<0.7; creases are edges longer than 0.25 mm. */
function wallCreases(
    geo: BufferGeometry,
    minDeg = 60,
): { count: number; minX: number; maxX: number; maxDeg: number; heelMaxDeg: number } {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!index) return { count: 0, minX: 0, maxX: 0, maxDeg: 0, heelMaxDeg: 0 };
    const q = 1e4;
    const idOf = (i: number) =>
        `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    const faces = index.count / 3;
    const normals: { x: number; y: number; z: number }[] = [];
    const wall: boolean[] = [];
    for (let t = 0; t < faces; t++) {
        const ia = index.getX(t * 3);
        const ib = index.getX(t * 3 + 1);
        const ic = index.getX(t * 3 + 2);
        const ax = pos.getX(ib) - pos.getX(ia);
        const ay = pos.getY(ib) - pos.getY(ia);
        const az = pos.getZ(ib) - pos.getZ(ia);
        const bx = pos.getX(ic) - pos.getX(ia);
        const by = pos.getY(ic) - pos.getY(ia);
        const bz = pos.getZ(ic) - pos.getZ(ia);
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        normals.push({ x: nx, y: ny, z: nz });
        wall.push(Math.abs(nz) < 0.7);
    }
    const edgeFaces = new Map<string, number[]>();
    const add = (a: number, b: number, t: number) => {
        const ka = idOf(a);
        const kb = idOf(b);
        const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const list = edgeFaces.get(k);
        if (list) list.push(t);
        else edgeFaces.set(k, [t]);
    };
    for (let t = 0; t < faces; t++) {
        add(index.getX(t * 3), index.getX(t * 3 + 1), t);
        add(index.getX(t * 3 + 1), index.getX(t * 3 + 2), t);
        add(index.getX(t * 3 + 2), index.getX(t * 3), t);
    }
    let count = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxDeg = 0;
    let heelMaxDeg = 0;
    for (const [k, ts] of edgeFaces) {
        if (ts.length !== 2) continue;
        const t0 = ts[0]!;
        const t1 = ts[1]!;
        if (!wall[t0] || !wall[t1]) continue;
        const n0 = normals[t0]!;
        const n1 = normals[t1]!;
        const dot = Math.max(-1, Math.min(1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        if (deg > maxDeg) maxDeg = deg;
        const [ka0] = k.split("|");
        const xa = Number(ka0!.split(",")[0]) / q;
        if (xa < 45 && deg > heelMaxDeg) heelMaxDeg = deg;
        if (deg <= minDeg) continue;
        const [ka, kb] = k.split("|");
        const pa = ka!.split(",").map(Number);
        const pb = kb!.split(",").map(Number);
        const len = Math.hypot((pa[0]! - pb[0]!) / q, (pa[1]! - pb[1]!) / q, (pa[2]! - pb[2]!) / q);
        if (len < 0.25) continue;
        count++;
        const x = (pa[0]! + pb[0]!) / (2 * q);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
    }
    return { count, minX: count ? minX : 0, maxX: count ? maxX : 0, maxDeg, heelMaxDeg };
}

/** Every z=0 face points down, and no exported face has zero area. */
function assertBottomFacesDown(geo: BufferGeometry): void {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    expect(index).toBeTruthy();
    if (!index) return;
    for (let t = 0; t < index.count; t += 3) {
        const ia = index.getX(t);
        const ib = index.getX(t + 1);
        const ic = index.getX(t + 2);
        const ax = pos.getX(ib) - pos.getX(ia);
        const ay = pos.getY(ib) - pos.getY(ia);
        const az = pos.getZ(ib) - pos.getZ(ia);
        const bx = pos.getX(ic) - pos.getX(ia);
        const by = pos.getY(ic) - pos.getY(ia);
        const bz = pos.getZ(ic) - pos.getZ(ia);
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        expect(nx * nx + ny * ny + nz * nz).toBeGreaterThan(0);
        if (Math.abs(pos.getZ(ia)) > 1e-4 || Math.abs(pos.getZ(ib)) > 1e-4 || Math.abs(pos.getZ(ic)) > 1e-4) {
            continue;
        }
        expect(nz).toBeLessThan(0);
    }
}

function assertBottomFlat(geo: BufferGeometry): void {
    const pos = geo.getAttribute("position");
    const ud = geo.userData as {
        plantarStart?: number;
        plantarEnd?: number;
        outlineVertexStart?: number;
        outlineVertexCount?: number;
    };
    const check = (i: number) => {
        expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(1e-3);
    };
    if (ud.plantarStart != null && ud.plantarEnd != null) {
        for (let i = ud.plantarStart; i < ud.plantarEnd; i++) check(i);
    }
    if (ud.outlineVertexStart != null && ud.outlineVertexCount) {
        for (let i = 0; i < ud.outlineVertexCount; i++) check(ud.outlineVertexStart + i);
    }
}

function topXy(geo: BufferGeometry): Float64Array {
    const n = (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const pos = geo.getAttribute("position");
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
        out[i * 2] = pos.getX(i);
        out[i * 2 + 1] = pos.getY(i);
    }
    return out;
}

/** Directed XY Hausdorff. Cell size 2 mm; the search stops once it covers the nearest hit. */
function directedHausdorffXY(from: Float64Array, to: Float64Array): number {
    const cell = 2;
    const bins = new Map<string, number[]>();
    const nTo = to.length / 2;
    for (let i = 0; i < nTo; i++) {
        const key = `${Math.floor(to[i * 2]! / cell)},${Math.floor(to[i * 2 + 1]! / cell)}`;
        const list = bins.get(key);
        if (list) list.push(i);
        else bins.set(key, [i]);
    }
    let max = 0;
    const nFrom = from.length / 2;
    for (let i = 0; i < nFrom; i++) {
        const x = from[i * 2]!;
        const y = from[i * 2 + 1]!;
        const ix = Math.floor(x / cell);
        const iy = Math.floor(y / cell);
        let best = Infinity;
        for (let rad = 0; rad < 40; rad++) {
            for (let dx = -rad; dx <= rad; dx++) {
                for (let dy = -rad; dy <= rad; dy++) {
                    if (rad > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
                    const list = bins.get(`${ix + dx},${iy + dy}`);
                    if (!list) continue;
                    for (const j of list) {
                        const d = Math.hypot(x - to[j * 2]!, y - to[j * 2 + 1]!);
                        if (d < best) best = d;
                    }
                }
            }
            // Unsearched cells are strictly farther than rad * cell.
            if (best <= rad * cell) break;
        }
        if (best > max) max = best;
    }
    return max;
}

function topXyDelta(
    posted: BufferGeometry,
    neutral: BufferGeometry,
): { indexed: number; countsEqual: boolean; neutralToPosted: number; postedToNeutral: number } {
    const na = (posted.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const nb = (neutral.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const pa = posted.getAttribute("position");
    const pb = neutral.getAttribute("position");
    const n = Math.min(na, nb, pa.count, pb.count);
    let indexed = 0;
    const countsEqual = na === nb && na > 0;
    if (countsEqual) {
        for (let i = 0; i < n; i++) {
            indexed = Math.max(indexed, Math.hypot(pa.getX(i) - pb.getX(i), pa.getY(i) - pb.getY(i)));
        }
        return { indexed, countsEqual, neutralToPosted: indexed, postedToNeutral: indexed };
    }
    const cloudP = topXy(posted);
    const cloudN = topXy(neutral);
    return {
        indexed,
        countsEqual,
        neutralToPosted: directedHausdorffXY(cloudN, cloudP),
        postedToNeutral: directedHausdorffXY(cloudP, cloudN),
    };
}

interface MeshCase {
    deg: number;
    size: number;
    side: Side;
    style: ProceduralWallStyle;
    edge?: "medial" | "lateral";
}

function prGateCases(): MeshCase[] {
    return [
        { deg: 5, size: 9, side: "right", style: "straight" },
        { deg: 5, size: 9, side: "right", style: "round", edge: "lateral" },
        { deg: 5, size: 9, side: "right", style: "round", edge: "medial" },
        { deg: 10, size: 9, side: "right", style: "round", edge: "lateral" },
        { deg: 10, size: 9, side: "right", style: "round", edge: "medial" },
        { deg: 5, size: 9, side: "right", style: "hybrid" },
        { deg: 5, size: 1, side: "right", style: "straight" }, // scaled Men's 1
    ];
}

function nightlyCases(): MeshCase[] {
    const out: MeshCase[] = [];
    for (const deg of [1, 5, 10]) {
        for (const size of [1, 9, 16]) {
            for (const side of ["left", "right"] as const) {
                for (const style of STYLES) out.push({ deg, size, side, style });
            }
        }
    }
    return out;
}

describe("full-length wedge export", () => {
    let raw: BufferGeometry;

    beforeAll(async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
    });

    async function preview(corrections: SideCorrections, meshCase: MeshCase): Promise<BufferGeometry> {
        const layout = insoleLayoutForUsMenSize(meshCase.size);
        const geo = raw.clone();
        const scale = layout.scale;
        if (Math.abs(scale - 1) > 1e-9) geo.scale(scale, scale, 1);
        const built = await reconstructProceduralPreview(geo, {
            wallStyle: meshCase.style,
            side: meshCase.side,
            corrections,
            sourceField: fieldFor(meshCase.side, corrections, layout.lengthMm, layout.widthMm),
        });
        geo.dispose();
        return built.geometry;
    }

    test("off and 0 mm exports match, and a regional wedge is unchanged", async () => {
        const meshCase: MeshCase = { deg: 0, size: 9, side: "right", style: "straight" };
        const none = await preview(blank(), meshCase);
        const zero = await preview(
            blank({ fullLengthWedge: { side: "lateral", value: 0, unit: "mm" } }),
            meshCase,
        );
        expect(stlMd5(zero)).toBe(stlMd5(none));
        none.dispose();
        zero.dispose();

        const regional = blank({ forefootWedge: { side: "lateral", value: 4, unit: "deg" } });
        const regionalOff = await preview(regional, meshCase);
        const regionalZero = await preview(
            blank({
                forefootWedge: regional.forefootWedge,
                fullLengthWedge: { side: "medial", value: 0, unit: "deg" },
            }),
            meshCase,
        );
        expect(stlMd5(regionalZero)).toBe(stlMd5(regionalOff));
        regionalOff.dispose();
        regionalZero.dispose();
    });

    test("posted solids stay watertight with a flat bottom and an unchanged rim", async () => {
        const cases = (process.env.FULL_LENGTH_WEDGE_GRID === "1" ? nightlyCases() : prGateCases()).filter(
            (c) => process.env.FL_SIZE == null || c.size === Number(process.env.FL_SIZE),
        );
        const neutralByKey = new Map<string, BufferGeometry>();
        try {
            for (const meshCase of cases) {
                const key = `${meshCase.size}|${meshCase.side}|${meshCase.style}`;
                let neutral = neutralByKey.get(key);
                if (!neutral) {
                    neutral = await preview(blank(), meshCase);
                    neutralByKey.set(key, neutral);
                }
                const corrections = blank({
                    fullLengthWedge: {
                        side: meshCase.edge ?? "lateral",
                        value: meshCase.deg,
                        unit: "deg",
                    },
                });
                const posted = await preview(corrections, meshCase);
                const report = analyzeManifold(posted);
                expect(report.isWatertight).toBe(true);
                expect(report.nonManifoldEdges).toBe(0);
                expect(eulerOf(posted)).toBe(2);
                assertBottomFacesDown(neutral);
                assertBottomFacesDown(posted);
                expect(countSelfIntersections(neutral).real).toBe(0);
                // Default 1e-5 mm weld flags rim-seam triangles whose vertices
                // sit within 0.05 mm. That is loft contact, not a remote hit.
                expect(countSelfIntersections(posted, 0.05).real).toBe(0);
                assertBottomFlat(posted);
                const xy = topXyDelta(posted, neutral);
                // Same vertex order: the top outline stays put.
                if (xy.countsEqual) expect(xy.indexed).toBeLessThanOrEqual(0.02);
                else {
                    // A scaled Men's 1 loft can insert a few samples. Every
                    // neutral top point must still land on the posted sheet.
                    // New samples stay within 1 mm (measured 0.735).
                    expect(xy.neutralToPosted).toBeLessThanOrEqual(0.02);
                    expect(xy.postedToNeutral).toBeLessThanOrEqual(1);
                }

                const frame = getBaseFootprintFrame(neutral, meshCase.side);
                const posN = neutral.getAttribute("position");
                const posP = posted.getAttribute("position");
                const topN = (neutral.userData as { topVertexCount?: number }).topVertexCount ?? 0;
                const points: RimXY[] = [];
                for (let i = 0; i < topN; i++) {
                    const x = (posN.array as ArrayLike<number>)[i * 3 + frame.lengthAxis]!;
                    const wid = (posN.array as ArrayLike<number>)[i * 3 + frame.widthAxis]!;
                    points.push({ x, y: frame.widthSign * (wid - frame.widCenter) });
                }
                const stations = buildWedgeStations(points, meshCase.side, corrections.fullLengthWedge, {
                    originX: frame.lenMin,
                    lengthMm: frame.lenSize,
                    medialPositiveY: meshCase.side === "left",
                    ordered: false,
                });
                expect(stations).not.toBeNull();
                for (const u of US) {
                    const xTarget = frame.lenMin + u * frame.lenSize;
                    let bestHigh = -1;
                    let bestLow = -1;
                    let yHigh = Number.NEGATIVE_INFINITY;
                    let yLow = Number.POSITIVE_INFINITY;
                    for (let i = 0; i < topN; i++) {
                        const x = (posN.array as ArrayLike<number>)[i * 3 + frame.lengthAxis]!;
                        if (Math.abs(x - xTarget) > frame.lenSize * 0.02) continue;
                        const wid = (posN.array as ArrayLike<number>)[i * 3 + frame.widthAxis]!;
                        const y = frame.widthSign * (wid - frame.widCenter);
                        if (y > yHigh) {
                            yHigh = y;
                            bestHigh = i;
                        }
                        if (y < yLow) {
                            yLow = y;
                            bestLow = i;
                        }
                    }
                    expect(bestHigh).toBeGreaterThanOrEqual(0);
                    expect(bestLow).toBeGreaterThanOrEqual(0);
                    const zAt = (i: number, pos: typeof posN) =>
                        (pos.array as ArrayLike<number>)[i * 3 + frame.thickAxis]!;
                    const highIdx = stations!.highPositiveY ? bestHigh : bestLow;
                    const lowIdx = stations!.highPositiveY ? bestLow : bestHigh;
                    const dHigh = zAt(highIdx, posP) - zAt(highIdx, posN);
                    const dLow = zAt(lowIdx, posP) - zAt(lowIdx, posN);
                    const rise = Math.abs(yHigh - yLow) * Math.tan(stations!.theta);
                    expect(dLow).toBeLessThanOrEqual(0.05);
                    expect(Math.abs(dHigh - dLow - rise)).toBeLessThanOrEqual(0.1);
                }

                const creases = wallCreases(posted);
                if (meshCase.style === "hybrid") {
                    const baseCreases = wallCreases(neutral);
                    // The blend already creases. The ruled rim must not open a
                    // fold outside that x-band. A few extra edges inside the
                    // band come from the tilted rim (5° measured 45 vs ~37).
                    expect(creases.minX).toBeGreaterThanOrEqual(baseCreases.minX - 0.5);
                    expect(creases.maxX).toBeLessThanOrEqual(baseCreases.maxX + 0.5);
                    expect(creases.count).toBeLessThanOrEqual(baseCreases.count + 10);
                } else if (meshCase.style === "round") {
                    const baseCreases = wallCreases(neutral);
                    expect(creases.count).toBe(0);
                    // Heel wall under the tilted rim stays with the neutral Round lip.
                    expect(creases.heelMaxDeg).toBeLessThanOrEqual(baseCreases.heelMaxDeg + 4);
                } else {
                    expect(creases.count).toBe(0);
                }
                posted.dispose();
            }
        } finally {
            for (const geo of neutralByKey.values()) geo.dispose();
        }
    }, 1_200_000);

    test("z=0 bottom faces point down on the style, edge, and angle grid", async () => {
        for (const style of STYLES) {
            for (const edge of ["medial", "lateral"] as const) {
                for (const deg of [1, 5, 10]) {
                    const meshCase: MeshCase = { deg, size: 9, side: "right", style, edge };
                    const geo = await preview(
                        blank({ fullLengthWedge: { side: edge, value: deg, unit: "deg" } }),
                        meshCase,
                    );
                    const report = analyzeManifold(geo);
                    expect(report.isWatertight).toBe(true);
                    expect(report.nonManifoldEdges).toBe(0);
                    assertBottomFacesDown(geo);
                    geo.dispose();
                }
            }
        }
    }, 1_200_000);

    test("forefoot width +5 mm with a full-length wedge holds the toe and the heel rise", async () => {
        // 72.19 mm widened heel rim: 72.19·tan(5°) = 6.32, 72.19·tan(10°) = 12.73.
        const heelRiseMm: Record<number, number> = { 5: 6.32, 10: 12.73 };
        const combos: Array<{ style: ProceduralWallStyle; edge: "lateral" | "medial"; deg: number }> = [];
        for (const style of STYLES) {
            combos.push({ style, edge: "lateral", deg: 5 }, { style, edge: "medial", deg: 10 });
        }
        const baseline = new Map<ProceduralWallStyle, BufferGeometry>();
        try {
            for (const style of STYLES) {
                baseline.set(
                    style,
                    await preview(blank({ forefootWidthMm: 5 }), {
                        deg: 0,
                        size: 9,
                        side: "right",
                        style,
                    }),
                );
            }
            for (const combo of combos) {
                const meshCase: MeshCase = {
                    deg: combo.deg,
                    size: 9,
                    side: "right",
                    style: combo.style,
                    edge: combo.edge,
                };
                const neutral = baseline.get(combo.style)!;
                const corrections = blank({
                    forefootWidthMm: 5,
                    fullLengthWedge: { side: combo.edge, value: combo.deg, unit: "deg" },
                });
                const posted = await preview(corrections, meshCase);
                try {
                    const report = analyzeManifold(posted);
                    expect(report.isWatertight).toBe(true);
                    expect(report.nonManifoldEdges).toBe(0);
                    assertBottomFacesDown(posted);

                    const frame = getBaseFootprintFrame(neutral, meshCase.side);
                    const posN = neutral.getAttribute("position");
                    const posP = posted.getAttribute("position");
                    const topN = (neutral.userData as { topVertexCount?: number }).topVertexCount ?? 0;
                    const points: RimXY[] = [];
                    for (let i = 0; i < topN; i++) {
                        const x = (posN.array as ArrayLike<number>)[i * 3 + frame.lengthAxis]!;
                        const wid = (posN.array as ArrayLike<number>)[i * 3 + frame.widthAxis]!;
                        points.push({ x, y: frame.widthSign * (wid - frame.widCenter) });
                    }
                    const stations = buildWedgeStations(points, meshCase.side, corrections.fullLengthWedge, {
                        originX: frame.lenMin,
                        lengthMm: frame.lenSize,
                        medialPositiveY: meshCase.side === "left",
                        ordered: false,
                    });
                    expect(stations).not.toBeNull();
                    const u = FULL_LENGTH_HEEL_U;
                    const xTarget = frame.lenMin + u * frame.lenSize;
                    let bestHigh = -1;
                    let bestLow = -1;
                    let yHigh = Number.NEGATIVE_INFINITY;
                    let yLow = Number.POSITIVE_INFINITY;
                    for (let i = 0; i < topN; i++) {
                        const x = (posN.array as ArrayLike<number>)[i * 3 + frame.lengthAxis]!;
                        if (Math.abs(x - xTarget) > frame.lenSize * 0.02) continue;
                        const wid = (posN.array as ArrayLike<number>)[i * 3 + frame.widthAxis]!;
                        const y = frame.widthSign * (wid - frame.widCenter);
                        if (y > yHigh) {
                            yHigh = y;
                            bestHigh = i;
                        }
                        if (y < yLow) {
                            yLow = y;
                            bestLow = i;
                        }
                    }
                    expect(bestHigh).toBeGreaterThanOrEqual(0);
                    expect(bestLow).toBeGreaterThanOrEqual(0);
                    const zAt = (i: number, pos: typeof posN) =>
                        (pos.array as ArrayLike<number>)[i * 3 + frame.thickAxis]!;
                    const highIdx = stations!.highPositiveY ? bestHigh : bestLow;
                    const lowIdx = stations!.highPositiveY ? bestLow : bestHigh;
                    const dHigh = zAt(highIdx, posP) - zAt(highIdx, posN);
                    const dLow = zAt(lowIdx, posP) - zAt(lowIdx, posN);
                    expect(dLow).toBeLessThanOrEqual(0.05);
                    const expected = heelRiseMm[combo.deg]!;
                    expect(Math.abs(dHigh - dLow - expected)).toBeLessThanOrEqual(0.1);

                    const baseCreases = wallCreases(neutral);
                    const creases = wallCreases(posted);
                    if (baseCreases.count === 0) {
                        expect(creases.count).toBe(0);
                    } else {
                        expect(creases.minX).toBeGreaterThanOrEqual(baseCreases.minX - 0.5);
                        expect(creases.maxX).toBeLessThanOrEqual(baseCreases.maxX + 0.5);
                        expect(creases.count).toBeLessThanOrEqual(baseCreases.count + 10);
                    }
                } finally {
                    posted.dispose();
                }
            }
        } finally {
            for (const geo of baseline.values()) geo.dispose();
        }
    }, 1_200_000);
});
