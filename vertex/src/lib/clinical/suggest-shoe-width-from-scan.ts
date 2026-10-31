// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { normalizeShoeWidth, SHOE_WIDTH_BALL_DELTA_MM, type ShoeWidthId } from "@/lib/geometry/shoe-width";

/** Map measured ball width to nearest width class vs Medium template ball width (5 mm steps). */
export function suggestShoeWidthFromBallWidth(args: { ballWidthMm: number; templateBallWidthMm: number }): {
    width: ShoeWidthId;
    deltaMm: number;
    confidence: "high" | "low";
} {
    const measured = args.ballWidthMm;
    const template = Math.max(1e-3, args.templateBallWidthMm);
    const delta = measured - template;
    const options: ShoeWidthId[] = ["narrow", "medium", "wide", "extra_wide"];
    let best: ShoeWidthId = "medium";
    let bestErr = Infinity;
    for (const id of options) {
        const target = template + SHOE_WIDTH_BALL_DELTA_MM[id];
        const err = Math.abs(measured - target);
        if (err < bestErr) {
            bestErr = err;
            best = id;
        }
    }
    const confidence = bestErr <= 3 ? "high" : "low";
    return { width: normalizeShoeWidth(best), deltaMm: delta, confidence };
}
