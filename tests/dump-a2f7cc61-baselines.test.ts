// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "@rstest/core";
import {
    countSelfIntersections,
    extractTopOnlyModel,
    fitClosedC2Spline,
    medialYSignFromTopRim,
    patternCurvatureReport,
    plantarFlatDeltaMm,
    reconstructionManifold,
    reconstructProceduralWalls,
    syntheticBottomPattern,
    windingReport,
} from "@/lib/geometry/procedural-wall";
import { hashClosedLoop, SHIPPED_PATTERN_SOURCE_SHA } from "@/lib/geometry/procedural-wall/shipped-pattern";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

const OUT = resolve(process.cwd(), "vertex/src/lib/geometry/procedural-wall/baselines");

const METRIC_KEYS = [
    "sourceSha",
    "stlMd5",
    "stlBytes",
    "watertight",
    "openEdges",
    "nonManifoldEdges",
    "windingConsistent",
    "oppositeEdgeMismatch",
    "signedVolume",
    "selfIntersections",
    "plantarAbsMaxZ",
    "acrossP99",
    "acrossP100",
    "eTurn",
    "fTurn",
    "alongRow",
    "g1Rm",
    "g1RAnalytic",
    "g1EAnalytic",
    "g1BAnalytic",
    "infl",
] as const;

describe("dump a2f7cc61 golden baselines", () => {
    test("write shipped pattern + per-style SAMPLE_Top metrics", async () => {
        const original = await loadSampleTopGlb();
        const model = extractTopOnlyModel(original, { id: "sample-top", name: "SAMPLE_Top" });
        const pos = model.top.meshPositions;
        const rimLocal = model.top.rimLocal ?? [];
        const rim3d = rimLocal.map((i) => ({
            x: pos![i * 3]!,
            y: pos![i * 3 + 1]!,
            z: pos![i * 3 + 2]!,
        }));
        const pattern = syntheticBottomPattern(rim3d, model.bounds, rim3d);
        const sign = medialYSignFromTopRim(rim3d, model.bounds);
        const curv = patternCurvatureReport(pattern, model.bounds, sign);
        const spline = fitClosedC2Spline(pattern);
        const patternHash = hashClosedLoop(pattern);
        const rimHash = hashClosedLoop(rim3d);
        mkdirSync(OUT, { recursive: true });
        writeFileSync(
            resolve(OUT, "sample-top-full-contact.json"),
            `${JSON.stringify(
                {
                    sourceSha: SHIPPED_PATTERN_SOURCE_SHA,
                    rimHash,
                    patternHash,
                    curvature: {
                        inflections: curv.inflections,
                        maxAbsDkDs: curv.maxAbsDkDs,
                        lateralMinK: curv.lateralMinK,
                    },
                    controls: spline.controls,
                    samples: pattern,
                },
                null,
                2,
            )}\n`,
        );
        const styles = ["straight", "round", "hybrid"] as const;
        const perStyle: Record<string, Record<string, unknown>> = {};
        for (const style of styles) {
            const geo = reconstructProceduralWalls(model, {
                bottomPattern: pattern,
                bottomPatternLabel: "synthetic",
                flatPlantar: true,
                wallStyle: style,
            });
            const q = (geo.userData as { columnQuality?: Record<string, number> }).columnQuality ?? {};
            const frames = (geo.userData as { wallFrames?: Array<{ inflCount?: number }> }).wallFrames ?? [];
            const infl = frames.reduce((m, f) => Math.max(m, f.inflCount ?? 0), 0);
            const man = reconstructionManifold(geo);
            const wind = windingReport(geo);
            const hits = countSelfIntersections(geo);
            const stl = Buffer.from(geometryToBinarySTL(geo));
            const md5 = createHash("md5").update(stl).digest("hex");
            const row: Record<string, unknown> = {
                sourceSha: SHIPPED_PATTERN_SOURCE_SHA,
                stlMd5: md5,
                stlBytes: stl.length,
                watertight: man.watertight,
                openEdges: man.openEdges,
                nonManifoldEdges: man.nonManifoldEdges,
                windingConsistent: wind.consistent,
                oppositeEdgeMismatch: wind.oppositeEdgeMismatch,
                signedVolume: wind.signedVolume,
                selfIntersections: hits.real,
                plantarAbsMaxZ: plantarFlatDeltaMm(geo),
                acrossP99: q.maxAcrossP99Deg ?? q.maxMidAcrossP99Deg,
                acrossP100: q.maxAcrossDeg,
                eTurn: q.maxETurningPlanDeg ?? q.maxETurningDeg,
                fTurn: q.maxFTurningPlanDeg ?? q.maxFTurningDeg,
                alongRow: q.maxAlongRowDeg,
                g1Rm: q.maxG1RMeshDeg,
                g1RAnalytic: q.maxG1RAnalyticDeg,
                g1EAnalytic: q.maxG1EAnalyticDeg,
                g1BAnalytic: q.maxG1BAnalyticDeg,
                infl,
            };
            perStyle[style] = Object.fromEntries(METRIC_KEYS.map((k) => [k, row[k]]));
            writeFileSync(resolve(OUT, `sample-top-${style}.stl.md5`), `${md5}\n`);
            geo.dispose();
        }
        writeFileSync(
            resolve(OUT, "sample-top-style-metrics.json"),
            `${JSON.stringify(perStyle, null, 2)}\n`,
        );
        const postingPatch = { rearfootWedge: { side: "lateral", value: 4, unit: "deg" } };
        const postingPerStyle: Record<string, Record<string, unknown>> = {};
        for (const style of styles) {
            const geo = reconstructProceduralWalls(model, {
                bottomPattern: pattern,
                bottomPatternLabel: "synthetic",
                flatPlantar: true,
                wallStyle: style,
                corrections: postingPatch,
            });
            const stl = Buffer.from(geometryToBinarySTL(geo));
            const md5 = createHash("md5").update(stl).digest("hex");
            postingPerStyle[style] = { stlMd5: md5, stlBytes: stl.length };
            writeFileSync(resolve(OUT, `sample-top-posting-4-${style}.stl.md5`), `${md5}\n`);
            geo.dispose();
        }
        writeFileSync(
            resolve(OUT, "sample-top-posting-4-metrics.json"),
            `${JSON.stringify(postingPerStyle, null, 2)}\n`,
        );
        console.log(
            "[DUMP-BASELINES]",
            JSON.stringify({
                patternHash,
                rimHash,
                inflections: curv.inflections,
                dkds: curv.maxAbsDkDs,
                styles: Object.fromEntries(
                    Object.entries(perStyle).map(([k, v]) => [k, { stlMd5: v.stlMd5, infl: v.infl }]),
                ),
            }),
        );
        original.dispose();
    }, 300_000);
});
