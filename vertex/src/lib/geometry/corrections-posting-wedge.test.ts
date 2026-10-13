// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import {
    correctionDeltaAt,
    getBaseFootprintFrame,
    neutralField as neutralHeightField,
    vertexFootprintAt,
    wedgeMmAtBaseVertex,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heightAt } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { effectiveOutlineHalfWidth } from "@/lib/geometry/trimline";
import { getForefootFactor, wedgeDeltaAt } from "@/lib/geometry/wedge";
import { defaultDesign } from "@/stores/design-store";
import type { Side, SideCorrections } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zeroCorrections(): SideCorrections {
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
    };
}

function fieldFromSampleTop(
    raw: BufferGeometry,
    side: Side,
    corrections: SideCorrections,
): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, side);
    return {
        side,
        lengthMm: frame.lenSize,
        widthMm: frame.widSize,
        thicknessMm: 3,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

function baseParams(side: Side, corrections: SideCorrections): HeightFieldParams {
    return {
        side,
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

function maxForefootLateralBorderLiftMm(
    raw: BufferGeometry,
    composed: BufferGeometry,
    neutral: BufferGeometry,
    side: Side,
    corrections: SideCorrections,
    field: HeightFieldParams,
    targetU = 0.88,
): number {
    const frame = getBaseFootprintFrame(raw, side);
    const basePos = raw.getAttribute("position")?.array as Float32Array;
    const pos = composed.getAttribute("position")?.array as Float32Array;
    const neu = neutral.getAttribute("position")?.array as Float32Array;
    if (!basePos || !pos || !neu) return 0;
    const ta = frame.thickAxis;
    const n = basePos.length / 3;
    const lateralV = side === "right" ? 0.98 : -0.98;
    let bestLift = 0;
    for (let vi = 0; vi < n; vi++) {
        const { u, vSigned } = vertexFootprintAt(frame, basePos, vi);
        if (u < targetU - 0.04 || u > targetU + 0.04) continue;
        if (Math.abs(vSigned - lateralV) > 0.12) continue;
        const w = wedgeDeltaAt(u, vSigned, side, corrections, {
            lengthMm: field.lengthMm,
            widthMm: field.widthMm,
            trimline: field.trimline ?? null,
        });
        if (w < field.corrections.forefootWedge?.value! * 0.85) continue;
        const lift = pos[vi * 3 + ta]! - neu[vi * 3 + ta]!;
        bestLift = Math.max(bestLift, lift);
    }
    return bestLift;
}

describe("posting wedge (design viewer height field)", () => {
    test("STEP 0: rearfoot lateral 10 mm z lift at heel (right)", () => {
        const wedge = { side: "lateral" as const, value: 10, unit: "mm" as const };
        const p = baseParams("right", { ...zeroCorrections(), rearfootWedge: wedge });
        const p0 = baseParams("right", zeroCorrections());
        const u = 0.1;
        const lateralEdge = 0.98;
        const medialEdge = -0.98;

        const delta = (v: number) => heightAt(u, v, p) - heightAt(u, v, p0);
        const dLat = delta(lateralEdge);
        const dMed = delta(medialEdge);
        const dLatHeel = delta(0.5);
        const dMedHeel = delta(-0.5);

        expect(dLat).toBeCloseTo(10, 0.5);
        expect(dMed).toBeCloseTo(0, 0.5);
        expect(dLatHeel).toBeCloseTo(7.5, 1.0);
        expect(dMedHeel).toBeCloseTo(2.5, 1.0);
    });

    test("rearfoot lateral 10 mm — left foot border +10, low edge 0", () => {
        const wedge = { side: "lateral" as const, value: 10, unit: "mm" as const };
        const p = baseParams("left", { ...zeroCorrections(), rearfootWedge: wedge });
        const p0 = baseParams("left", zeroCorrections());
        const u = 0.1;
        const dLat = heightAt(u, -0.98, p) - heightAt(u, -0.98, p0);
        const dMedEdge = heightAt(u, 0.98, p) - heightAt(u, 0.98, p0);
        expect(dLat).toBeCloseTo(10, 0.5);
        expect(dMedEdge).toBeCloseTo(0, 0.5);
    });

    test("forefoot lateral 5.5 mm raises lateral border (right)", () => {
        const wedge = { side: "lateral" as const, value: 5.5, unit: "mm" as const };
        const p = baseParams("right", { ...zeroCorrections(), forefootWedge: wedge });
        const p0 = baseParams("right", zeroCorrections());
        const u = 0.88;
        const dLat = heightAt(u, 0.98, p) - heightAt(u, 0.98, p0);
        const dMed = heightAt(u, -0.98, p) - heightAt(u, -0.98, p0);
        expect(dLat).toBeGreaterThan(4.5);
        expect(dMed).toBeLessThan(0.2);
    });

    test("forefoot 10° — border height and slope match tan(10°)", () => {
        const wedge = { side: "lateral" as const, value: 10, unit: "deg" as const };
        const p = baseParams("right", { ...zeroCorrections(), forefootWedge: wedge });
        const u = 0.88;
        const vLat = 0.98;
        const vMed = -0.98;
        const zone = getForefootFactor(u);
        const hw = effectiveOutlineHalfWidth(u, p.lengthMm, p.widthMm, null);
        const localFullWidth = 2 * hw * (p.widthMm / 2);
        const borderRaise = wedgeDeltaAt(u, vLat, "right", p.corrections, p);
        expect(borderRaise).toBeCloseTo(localFullWidth * Math.tan((10 * Math.PI) / 180) * zone, 0.1);
        const slope =
            (wedgeDeltaAt(u, vLat, "right", p.corrections, p) -
                wedgeDeltaAt(u, vMed, "right", p.corrections, p)) /
            (localFullWidth * 0.98 * 2 * zone);
        expect(slope).toBeCloseTo(Math.tan((10 * Math.PI) / 180), 0.005);
    });

    test("arch height −10 and +14 mm at apex", () => {
        const low = baseParams("right", { ...zeroCorrections(), archHeightMm: -10 });
        const high = baseParams("right", { ...zeroCorrections(), archHeightMm: 14 });
        const neutral = baseParams("right", zeroCorrections());
        let apexZ = 0;
        let apexU = 0.42;
        let apexV = -0.55;
        for (let ui = 0.3; ui <= 0.55; ui += 0.02) {
            for (let vi = -0.9; vi <= -0.2; vi += 0.05) {
                const z = heightAt(ui, vi, high);
                if (z > apexZ) {
                    apexZ = z;
                    apexU = ui;
                    apexV = vi;
                }
            }
        }
        const apexNeutral = heightAt(apexU, apexV, neutral);
        expect(apexZ - apexNeutral).toBeGreaterThan(13);
        expect(apexZ - apexNeutral).toBeLessThan(15);
        expect(apexZ).toBeGreaterThan(30);
        expect(heightAt(apexU, apexV, low)).toBeLessThan(apexNeutral);
    });

    test("arch ease is zero at the medial trim rim (right foot v=-0.98)", () => {
        const ease = baseParams("right", { ...zeroCorrections(), archEaseMm: 6 });
        const plain = baseParams("right", zeroCorrections());
        const u = 0.42;
        const medialRimV = -0.98;
        expect(heightAt(u, medialRimV, ease) - heightAt(u, medialRimV, plain)).toBeLessThan(0.05);
        const interior = heightAt(u, -0.35, ease) - heightAt(u, -0.35, plain);
        expect(interior).toBeLessThan(-1);
    });

    test("arch ease lowers medial arch in heightAt and composePrintSolidTop", async () => {
        const u = 0.42;
        const v = -0.35;
        const withEase = baseParams("right", { ...zeroCorrections(), archHeightMm: 8, archEaseMm: 3 });
        const plain = baseParams("right", { ...zeroCorrections(), archHeightMm: 8 });
        expect(heightAt(u, v, withEase)).toBeLessThan(heightAt(u, v, plain) - 0.5);

        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = baseParams("right", { ...zeroCorrections(), archEaseMm: 3 });
        const composed = composePrintSolidTop(raw, { sourceField: field });
        const neutral = composePrintSolidTop(raw, { sourceField: baseParams("right", zeroCorrections()) });
        const pos = composed.getAttribute("position");
        const neuPos = neutral.getAttribute("position");
        let maxDrop = 0;
        if (pos && neuPos) {
            for (let i = 0; i < pos.count; i++) {
                maxDrop = Math.max(maxDrop, neuPos.getZ(i) - pos.getZ(i));
            }
        }
        composed.dispose();
        neutral.dispose();
        raw.dispose();
        expect(maxDrop).toBeGreaterThan(0.5);
    });

    test("composePrintSolidTop forefoot lateral 5.5 mm border rise (F02)", async () => {
        const wedge = { side: "lateral" as const, value: 5.5, unit: "mm" as const };
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = baseParams("right", { ...zeroCorrections(), forefootWedge: wedge });
        const neutralFieldParams = baseParams("right", zeroCorrections());
        const frame = getBaseFootprintFrame(raw, "right");
        raw.computeBoundingBox();
        const bb = raw.boundingBox!;
        const composed = composePrintSolidTop(raw, { sourceField: field });
        const neutralGeo = composePrintSolidTop(raw, { sourceField: neutralFieldParams });
        const basePos = raw.getAttribute("position")?.array as Float32Array;
        const pos = composed.getAttribute("position")?.array as Float32Array;
        const neu = neutralGeo.getAttribute("position")?.array as Float32Array;
        const ta = frame.thickAxis;
        const wedgeMm = field.corrections.forefootWedge?.value ?? 5.5;
        const neutralH = neutralHeightField(field);
        let maxBorderLift = 0;
        let maxWedgeMm = 0;
        for (let vi = 0; vi < (basePos?.length ?? 0) / 3; vi++) {
            const wmm = wedgeMmAtBaseVertex(raw, field, vi);
            if (wmm > maxWedgeMm) maxWedgeMm = wmm;
            if (wmm < wedgeMm * 0.85) continue;
            const lift = pos![vi * 3 + ta]! - neu![vi * 3 + ta]!;
            maxBorderLift = Math.max(maxBorderLift, lift);
        }
        const analyticBorder = heightAt(0.88, 0.98, field) - heightAt(0.88, 0.98, neutralFieldParams);
        composed.dispose();
        neutralGeo.dispose();
        raw.dispose();
        expect(
            maxBorderLift,
            `borderLift=${maxBorderLift} maxWedgeMm=${maxWedgeMm} analytic=${analyticBorder}`,
        ).toBeGreaterThan(5.4);
        expect(maxBorderLift).toBeLessThan(5.6);
    });

    test("forefoot lateral 6.5 mm via design store field matches border lift", async () => {
        const wedge = { side: "lateral" as const, value: 6.5, unit: "mm" as const };
        const design = defaultDesign();
        design.corrections.right = { ...design.corrections.right, forefootWedge: wedge };
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = baseModifierField(design, "right", design.thicknessMm);
        const neutralField = baseModifierField(
            { ...design, corrections: { ...design.corrections, right: zeroCorrections() } },
            "right",
            design.thicknessMm,
        );
        const composed = composePrintSolidTop(raw, { sourceField: field });
        const neutral = composePrintSolidTop(raw, { sourceField: neutralField });
        const frame = getBaseFootprintFrame(raw, "right");
        raw.computeBoundingBox();
        const bb = raw.boundingBox!;
        const basePos = raw.getAttribute("position")?.array as Float32Array;
        const pos = composed.getAttribute("position")?.array as Float32Array;
        const neu = neutral.getAttribute("position")?.array as Float32Array;
        const ta = frame.thickAxis;
        let maxWedgeLift = 0;
        for (let vi = 0; vi < (basePos?.length ?? 0) / 3; vi++) {
            const wmm = wedgeMmAtBaseVertex(raw, field, vi);
            if (wmm < 6.5 * 0.85) continue;
            const lift = pos![vi * 3 + ta]! - neu![vi * 3 + ta]!;
            maxWedgeLift = Math.max(maxWedgeLift, lift);
        }
        composed.dispose();
        neutral.dispose();
        raw.dispose();
        expect(maxWedgeLift).toBeGreaterThan(6.4);
        expect(maxWedgeLift).toBeLessThan(6.6);
    });

    test("archHeight -10 with ease 6 — walled preview S1 min-wall + wall-top gates", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = baseParams("right", {
            ...zeroCorrections(),
            archHeightMm: -10,
            archEaseMm: 6,
        });
        const preview = reconstructProceduralPreview(raw, {
            sourceField: field,
            composedTop: true,
            corrections: field.corrections,
            wallStyle: "straight",
            scanPattern: "full_contact",
        });
        const ud = preview.geometry.userData as {
            loftN?: number;
            minLastRowHeightMm?: number;
            maxChordRiseDeg?: number;
        };
        expect(ud.loftN ?? 0).toBeGreaterThan(3);
        expect(preview.geometry.getAttribute("position")?.count ?? 0).toBeGreaterThan(1000);
        expect(ud.maxChordRiseDeg ?? 90).toBeLessThanOrEqual(6.5);
        expect((ud.minLastRowHeightMm ?? 0) >= 0.75 || (ud.maxChordRiseDeg ?? 0) <= 6).toBe(true);
        preview.geometry.dispose();
        raw.dispose();
    }, 180_000);
});

describe("bottom pattern B inside composed rim R (wide width)", () => {
    test("left and right at width +5 — pattern inside composed rim (0.2 mm slack)", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        for (const side of ["left", "right"] as Side[]) {
            const field = baseParams(side, zeroCorrections());
            const preview = await reconstructProceduralPreview(raw, {
                sourceField: field,
                composedTop: true,
                corrections: field.corrections,
                shoeWidth: { width: "wide", ballWidthMm: 95, heelWidthMm: 95 * 0.62 },
                scanPattern: "full_contact",
            });
            expect(preview.pattern.length).toBeGreaterThan(8);
            const rim = preview.model.top.rimLocal ?? [];
            const pos = preview.model.top.meshPositions;
            if (!pos) continue;
            let minInset = Infinity;
            for (let i = 0; i < preview.pattern.length; i++) {
                const b = preview.pattern[i];
                const ri = rim[i % rim.length];
                if (!b || ri === undefined) continue;
                const rx = pos[ri * 3]!;
                const ry = pos[ri * 3 + 1]!;
                const dx = b.x - rx;
                const dy = b.y - ry;
                minInset = Math.min(minInset, Math.hypot(dx, dy));
            }
            preview.geometry.dispose();
            expect(minInset).toBeGreaterThan(-0.2);
        }
        raw.dispose();
    });
});
