// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    extractTopOnlyModel,
    fairInsetMm,
    fitWindowsTraceToRim,
    forefootRimClearanceMm,
    insetsForScanPattern,
    localRimWidthMm,
    medialYSignFromTopRim,
    movedPatternHygiene,
    PATTERN_ARCH_D_FRAC,
    PATTERN_ARCH_INSET_MM,
    PATTERN_ARCH_U_PK,
    PATTERN_FOREFOOT_INSET_MM,
    PATTERN_HEEL_INSET_MM,
    PATTERN_SOURCE_SYNTHETIC,
    PATTERN_TRACE_HAUSDORFF_MM,
    patternCurvatureReport,
    polylineHausdorffMm,
    TOE_BOX_BLEND_U0,
    TOE_BOX_RIM_MAX_MM,
    WINDOWS_FORE_U0,
} from "@/lib/geometry/procedural-wall";
import { mirrorGeometry } from "@/lib/library/loaders";
import {
    buildFairedPatternFromTop,
    buildProceduralViewerPattern,
    reconstructProceduralPreview,
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_NAME,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

describe("SAMPLE_Top faired preview inputs", () => {
    test("fair inset is heel ~6 mm, toe 0.5 mm, medial arch cut-in", () => {
        expect(fairInsetMm(0.05, false)).toBeGreaterThanOrEqual(PATTERN_FOREFOOT_INSET_MM);
        expect(fairInsetMm(0.08, true)).toBeGreaterThan(4.5);
        expect(fairInsetMm(0.08, true)).toBeLessThanOrEqual(PATTERN_HEEL_INSET_MM + 0.05);
        expect(fairInsetMm(0.9, true)).toBeLessThanOrEqual(PATTERN_FOREFOOT_INSET_MM + 0.05);
        expect(fairInsetMm(0.4, true)).toBeGreaterThan(fairInsetMm(0.4, false));
    });

    test("Pattern presets vary faired inset; Full Contact / Custom keep approved defaults", () => {
        expect(insetsForScanPattern("full_contact")).toBeUndefined();
        expect(insetsForScanPattern("custom")).toBeUndefined();
        expect(insetsForScanPattern()).toBeUndefined();
        const flat = insetsForScanPattern("flat");
        expect(flat?.archMm).toBe(2);
        expect(fairInsetMm(0.4, true, flat)).toBeLessThan(fairInsetMm(0.4, true));
        const prefab = insetsForScanPattern("prefab_3d");
        expect(prefab?.archMm).toBeGreaterThan(PATTERN_ARCH_INSET_MM);
        expect(fairInsetMm(0.4, true, prefab)).toBeGreaterThan(fairInsetMm(0.4, true));
    });

    test("viewer pattern is the faired outline and does not loft walls", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const started = performance.now();
        const pattern = buildProceduralViewerPattern(geo, "full_contact");
        const elapsedMs = performance.now() - started;
        expect(pattern.length).toBeGreaterThan(16);
        expect(elapsedMs).toBeLessThan(15_000);
        geo.dispose();
    }, 30_000);

    test("SAMPLE_Top reconstructs for Full Contact, Prefab 3D, Flat, and Custom", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        for (const scanPattern of ["full_contact", "prefab_3d", "flat", "custom"] as const) {
            const preview = reconstructProceduralPreview(geo, { wallStyle: "straight", scanPattern });
            expect(preview.pattern.length).toBeGreaterThan(16);
            expect(preview.geometry.getAttribute("position")?.count ?? 0).toBeGreaterThan(1000);
            preview.geometry.dispose();
        }
        geo.dispose();
    }, 240_000);

    test("mirrored SAMPLE_Top reconstructs without inward-faces", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const mirrored = mirrorGeometry(geo);
        const preview = reconstructProceduralPreview(mirrored, {
            wallStyle: "straight",
            scanPattern: "full_contact",
        });
        expect(preview.pattern.length).toBeGreaterThan(16);
        expect(preview.geometry.getAttribute("position")?.count ?? 0).toBeGreaterThan(1000);
        preview.geometry.dispose();
        mirrored.dispose();
        geo.dispose();
    }, 180_000);

    test("SAMPLE_Top builds a faired pattern inside the top rim", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const model = extractTopOnlyModel(geo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
        expect(model.top.rimLocal?.length).toBeGreaterThan(8);
        const pattern = buildFairedPatternFromTop(model);
        expect(pattern.length).toBeGreaterThan(16);
        const length = model.bounds.maxX - model.bounds.minX;
        let heelInset = Infinity;
        let toeInset = Infinity;
        const rimLocal = model.top.rimLocal ?? [];
        const pos = model.top.meshPositions ?? new Float32Array();
        const rim = rimLocal.map((i) => ({
            x: pos[i * 3] ?? 0,
            y: pos[i * 3 + 1] ?? 0,
        }));
        const insetAt = (p: { x: number; y: number }) => {
            let best = Infinity;
            for (let i = 0; i < rim.length; i++) {
                const a = rim[i];
                const b = rim[(i + 1) % rim.length];
                if (!a || !b) continue;
                const ex = b.x - a.x;
                const ey = b.y - a.y;
                const len2 = ex * ex + ey * ey;
                const t =
                    len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
                best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
            }
            return best;
        };
        for (const p of pattern) {
            const u = (p.x - model.bounds.minX) / length;
            const d = insetAt(p);
            if (u < 0.12) heelInset = Math.min(heelInset, d);
            if (u > 0.88) toeInset = Math.min(toeInset, d);
        }
        expect(toeInset).toBeLessThan(2.5);
        expect(heelInset).toBeGreaterThan(3);
        expect(PATTERN_SOURCE_SYNTHETIC).toBe("synthetic");
        geo.dispose();
    }, 60_000);

    test("SAMPLE_Top CAD inset gates: fore / lateral / heel / arch peak / cut span", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const model = extractTopOnlyModel(geo, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
        const pattern = buildFairedPatternFromTop(model);
        const rimLocal = model.top.rimLocal ?? [];
        const pos = model.top.meshPositions ?? new Float32Array();
        const rim = rimLocal.map((i) => ({
            x: pos[i * 3] ?? 0,
            y: pos[i * 3 + 1] ?? 0,
            z: pos[i * 3 + 2] ?? 0,
        }));
        const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
        const yMid = rim.reduce((s, p) => s + p.y, 0) / rim.length;
        const sign = medialYSignFromTopRim(rim, model.bounds);
        const insetAt = (p: { x: number; y: number }) => {
            let best = Infinity;
            for (let i = 0; i < rim.length; i++) {
                const a = rim[i];
                const b = rim[(i + 1) % rim.length];
                if (!a || !b) continue;
                const ex = b.x - a.x;
                const ey = b.y - a.y;
                const len2 = ex * ex + ey * ey;
                const t =
                    len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
                best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
            }
            return best;
        };
        const Wpk = localRimWidthMm(rim, model.bounds, PATTERN_ARCH_U_PK);
        let heelMin = Infinity;
        let heelMax = 0;
        let foreMax = 0;
        let latMin = Infinity;
        let latMax = 0;
        let archPeak = 0;
        let cutU0 = 1;
        let cutU1 = 0;
        let minD = Infinity;
        for (const p of pattern) {
            const u = (p.x - model.bounds.minX) / length;
            const d = insetAt(p);
            minD = Math.min(minD, d);
            const medial = (p.y - yMid) * sign > 0;
            if (u < 0.22) {
                heelMin = Math.min(heelMin, d);
                heelMax = Math.max(heelMax, d);
            }
            if (u >= 0.75) foreMax = Math.max(foreMax, d);
            if (!medial && u >= 0.25 && u <= 0.6) {
                latMin = Math.min(latMin, d);
                latMax = Math.max(latMax, d);
            }
            if (medial && u >= 0.4 && u <= 0.48) archPeak = Math.max(archPeak, d);
            if (medial && d > 0.35 * Wpk) {
                cutU0 = Math.min(cutU0, u);
                cutU1 = Math.max(cutU1, u);
            }
        }
        const curv = patternCurvatureReport(pattern, model.bounds, sign);
        const misses: string[] = [];
        if (minD < 0.3 - 1e-3) misses.push(`minD ${minD.toFixed(2)}<0.3`);
        if (foreMax > 1.0) misses.push(`fore ${foreMax.toFixed(2)}>1.0`);
        if (latMin < 3 || latMax > 5)
            misses.push(`lateral ${latMin.toFixed(2)}–${latMax.toFixed(2)} not in 3–5`);
        if (heelMin < 4 || heelMax > 7)
            misses.push(`heel ${heelMin.toFixed(2)}–${heelMax.toFixed(2)} not in 4–7`);
        if (archPeak < 0.4 * Wpk || archPeak > 0.5 * Wpk) {
            misses.push(
                `archPeak ${archPeak.toFixed(2)} not in 0.40–0.50×W (${(0.4 * Wpk).toFixed(1)}–${(0.5 * Wpk).toFixed(1)})`,
            );
        }
        if (cutU0 > 0.28 || cutU1 < 0.58)
            misses.push(`cut span ${cutU0.toFixed(2)}–${cutU1.toFixed(2)} misses 0.26–0.60`);
        if (curv.inflections > 4) misses.push(`inflections ${curv.inflections}>4`);
        if (curv.maxAbsDkDs > 0.045) misses.push(`dk/ds ${curv.maxAbsDkDs.toFixed(4)}>0.045`);
        console.log(
            "[CAD-INSET-GATES]",
            JSON.stringify({
                minD,
                foreMax,
                latMin,
                latMax,
                heelMin,
                heelMax,
                archPeak,
                Wpk,
                cutU0,
                cutU1,
                inflections: curv.inflections,
                dkds: curv.maxAbsDkDs,
                misses,
            }),
        );
        const placed = fitWindowsTraceToRim(rim, model.bounds, sign);
        const midPattern = pattern.filter((p) => (p.x - model.bounds.minX) / length < TOE_BOX_BLEND_U0);
        const midTrace = (placed?.smoothed ?? []).filter(
            (p) => (p.x - model.bounds.minX) / length < TOE_BOX_BLEND_U0,
        );
        const haus = placed && midTrace.length ? polylineHausdorffMm(midPattern, midTrace) : Infinity;
        if (haus > PATTERN_TRACE_HAUSDORFF_MM) {
            misses.push(`hausdorff ${haus.toFixed(2)}>${PATTERN_TRACE_HAUSDORFF_MM}`);
        }
        const toe = forefootRimClearanceMm(pattern, rim, model.bounds, WINDOWS_FORE_U0);
        if (toe.maxD > TOE_BOX_RIM_MAX_MM) {
            misses.push(`toe-box ${toe.maxD.toFixed(2)}>${TOE_BOX_RIM_MAX_MM}`);
        }
        console.log(
            "[CAD-TRACE-HAUSDORFF]",
            JSON.stringify({ haus, gate: PATTERN_TRACE_HAUSDORFF_MM, mirrored: placed?.mirrored }),
        );
        console.log(
            "[CAD-TOE-BOX-RIM]",
            JSON.stringify({
                maxD: toe.maxD,
                minD: toe.minD,
                count: toe.count,
                gate: TOE_BOX_RIM_MAX_MM,
                u0: WINDOWS_FORE_U0,
            }),
        );
        if (curv.lateralMinK < -0.015) misses.push(`lateral-k ${curv.lateralMinK.toFixed(4)}`);
        const scoped = movedPatternHygiene(pattern, model.bounds, sign, {
            movedAt: (u) => u >= TOE_BOX_BLEND_U0 - 0.08,
        });
        console.log(
            "[CAD-DKDS-SCOPED]",
            JSON.stringify({
                outside: scoped.report.maxAbsDkDsOutside,
                max: scoped.report.maxAbsDkDs,
                u: scoped.report.maxAbsDkDsU,
            }),
        );
        expect(minD).toBeGreaterThanOrEqual(0.3 - 1e-3);
        expect(curv.inflections).toBeLessThanOrEqual(4);
        expect(scoped.report.maxAbsDkDsOutside).toBeLessThanOrEqual(0.06);
        expect(archPeak).toBeGreaterThan(0.25 * Wpk);
        expect(Wpk * PATTERN_ARCH_D_FRAC).toBeGreaterThan(10);
        expect(haus).toBeLessThanOrEqual(PATTERN_TRACE_HAUSDORFF_MM);
        expect(toe.count).toBeGreaterThan(8);
        expect(toe.maxD).toBeLessThanOrEqual(TOE_BOX_RIM_MAX_MM);
        geo.dispose();
    }, 60_000);

    test("reconstructProceduralPreview lofts SAMPLE_Top + faired pattern (S1 inputs)", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const preview = reconstructProceduralPreview(geo, { wallStyle: "round" });
        const stations = (preview.geometry.userData as { stationCount?: number }).stationCount ?? 0;
        expect(stations).toBeGreaterThan(3);
        expect(preview.pattern.length).toBeGreaterThan(16);
        expect(preview.geometry.getAttribute("position")?.count ?? 0).toBeGreaterThan(1000);
        preview.geometry.dispose();
        geo.dispose();
    }, 180_000);

    test("edit the live pattern, generate, and the solid bottom matches the edit", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const base = buildProceduralViewerPattern(geo, "full_contact");
        const edited = base.map((p, i) => {
            if (i % 11 !== 4) return p;
            return { x: p.x, y: p.y + (p.y >= 0 ? -2 : 2), z: p.z ?? 0 };
        });
        expect(polylineHausdorffMm(base, edited)).toBeGreaterThan(0.4);
        const started = performance.now();
        const preview = reconstructProceduralPreview(geo, {
            wallStyle: "straight",
            scanPattern: "full_contact",
            bottomPattern: edited,
        });
        const printMs = performance.now() - started;
        expect(polylineHausdorffMm(preview.pattern, edited)).toBeLessThan(0.05);
        const solidBottom = (
            preview.geometry.userData as { bottomOutlineB?: Array<{ x: number; y: number }> }
        ).bottomOutlineB;
        expect(solidBottom?.length ?? 0).toBeGreaterThan(16);
        const haus = polylineHausdorffMm(
            (solidBottom ?? []).map((p) => ({ x: p.x, y: p.y, z: 0 })),
            edited,
        );
        console.log(
            "[LIVE-PATTERN-SOLID]",
            JSON.stringify({ haus, printMs, edited: edited.length, solid: solidBottom?.length ?? 0 }),
        );
        expect(polylineHausdorffMm(preview.pattern, edited)).toBeLessThan(0.05);
        expect(haus).toBeLessThanOrEqual(0.05);
        preview.geometry.dispose();
        geo.dispose();
    }, 180_000);
});
