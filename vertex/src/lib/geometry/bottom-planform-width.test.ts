// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import {
    applyShoeWidthToGeometry,
    applyShoeWidthToPoints,
    SHOE_WIDTH_BALL_DELTA_MM,
    type ShoeWidthId,
    shoeWidthReferenceOfGeometry,
    shoeWidthScaleAtU,
} from "@/lib/geometry/shoe-width";
import { extractMeshOutline } from "@/lib/geometry/trimline";
import {
    buildProceduralViewerPattern,
    loadSampleTopGeometry,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "./procedural-wall/sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const WIDTHS: ShoeWidthId[] = ["narrow", "wide", "extra_wide", "xx_wide"];
const SIZES = [6, 10];

function edgesAt(
    points: readonly { x: number; y: number }[],
    x: number,
): { lo: number; hi: number; width: number } | null {
    const ys: number[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-9) {
            if (Math.abs(a.x - x) <= 0.25) ys.push(a.y, b.y);
            continue;
        }
        const t = (x - a.x) / dx;
        if (t < -1e-4 || t > 1 + 1e-4) continue;
        ys.push(a.y + t * (b.y - a.y));
    }
    if (ys.length < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const y of ys) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
    }
    return { lo, hi, width: hi - lo };
}

async function loadRaw() {
    resetSampleTopGeometryCache();
    const bytes = readFileSync(SAMPLE_TOP_PATH);
    primeSampleTopGeometry(
        await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
    );
    return loadSampleTopGeometry();
}

describe("shared 1D shoe-width scale", () => {
    test("Medium width leaves the top mesh and the bottom pattern byte-identical", async () => {
        const raw = await loadRaw();
        const ref = shoeWidthReferenceOfGeometry(raw);
        const pattern = buildProceduralViewerPattern(raw, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        const opts = {
            ballWidthMm: ref.ballWidthMm,
            heelWidthMm: ref.heelWidthMm,
            minX: ref.frame.minX,
            lengthMm: ref.frame.lengthMm,
            yMid: ref.frame.yMid,
        };
        expect(applyShoeWidthToPoints(pattern, "medium", opts)).toBe(pattern);
        const medium = applyShoeWidthToGeometry(raw, "medium", opts);
        const src = raw.getAttribute("position");
        const dst = medium.getAttribute("position");
        if (!src || !dst) throw new Error("medium mesh has no position");
        expect(dst.count).toBe(src.count);
        const a = src.array as Float32Array;
        const b = dst.array as Float32Array;
        expect(b.length).toBe(a.length);
        for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]);
        medium.dispose();
        raw.dispose();
    }, 120_000);

    test("M6 and M10 share one forefoot delta, a heel taper, and a bottom that stays on the top", async () => {
        const raw = await loadRaw();
        const ref = shoeWidthReferenceOfGeometry(raw);
        const pattern = buildProceduralViewerPattern(raw, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        const outline = extractMeshOutline(raw, 80);
        if (!outline) throw new Error("default top has no outline");
        const opts = {
            ballWidthMm: ref.ballWidthMm,
            heelWidthMm: ref.heelWidthMm,
            minX: ref.frame.minX,
            lengthMm: ref.frame.lengthMm,
            yMid: ref.frame.yMid,
        };
        const failures: string[] = [];
        const stations: number[] = [];
        for (let i = 1; i < 20; i++) stations.push(i / 20);

        for (const size of SIZES) {
            // Shoe size must not change the scale. The denominator is the
            // default mesh width, so M6 and M10 add the same millimetres.
            const layout = insoleLayoutForUsMenSize(size);
            expect(Math.abs(layout.widthMm - ref.ballWidthMm)).toBeGreaterThan(1);

            for (const width of WIDTHS) {
                const delta = SHOE_WIDTH_BALL_DELTA_MM[width];
                const top = applyShoeWidthToGeometry(raw, width, opts);
                const bottom = applyShoeWidthToPoints(pattern, width, opts);
                const scaledOutline = applyShoeWidthToPoints(outline.points, width, opts);
                const topOutline = extractMeshOutline(top, 80);
                const label = `M${size} ${width}`;
                if (!topOutline) {
                    failures.push(`${label}: no top outline`);
                    if (top !== raw) top.dispose();
                    continue;
                }

                const srcPos = raw.getAttribute("position");
                const dstPos = top.getAttribute("position");
                if (!srcPos || !dstPos) throw new Error(`${label}: missing position`);
                for (let i = 0; i < Math.min(srcPos.count, 40); i++) {
                    if (dstPos.getX(i) !== srcPos.getX(i) || dstPos.getZ(i) !== srcPos.getZ(i)) {
                        failures.push(`${label}: vertex ${i} changed X or Z`);
                        break;
                    }
                }

                const foreX = ref.frame.minX + ref.forefootU * ref.frame.lengthMm;
                const heelX = ref.frame.minX + ref.heelU * ref.frame.lengthMm;
                const midX = ref.frame.minX + 0.28 * ref.frame.lengthMm;
                const foreTop = edgesAt(topOutline.points, foreX);
                const foreMed = edgesAt(outline.points, foreX);
                const heelTop = edgesAt(topOutline.points, heelX);
                const heelMed = edgesAt(outline.points, heelX);
                const midTop = edgesAt(topOutline.points, midX);
                const midMed = edgesAt(outline.points, midX);
                const foreBot = edgesAt(bottom, foreX);
                const foreBotMed = edgesAt(pattern, foreX);
                if (
                    !foreTop ||
                    !foreMed ||
                    !heelTop ||
                    !heelMed ||
                    !midTop ||
                    !midMed ||
                    !foreBot ||
                    !foreBotMed
                ) {
                    failures.push(`${label}: missing station chord`);
                } else {
                    const foreChange = foreTop.width - foreMed.width;
                    const heelChange = heelTop.width - heelMed.width;
                    const midChange = midTop.width - midMed.width;
                    const botChange = foreBot.width - foreBotMed.width;
                    if (Math.abs(foreChange - delta) > 0.35) {
                        failures.push(`${label}: forefoot change ${foreChange.toFixed(2)} vs delta ${delta}`);
                    }
                    if (Math.abs(botChange - delta) > 1) {
                        failures.push(
                            `${label}: bottom forefoot change ${botChange.toFixed(2)} vs delta ${delta}`,
                        );
                    }
                    if (Math.abs(heelChange) >= Math.abs(foreChange) - 0.5) {
                        failures.push(
                            `${label}: heel change ${heelChange.toFixed(2)} does not taper under forefoot ${foreChange.toFixed(2)}`,
                        );
                    }
                    const towardFore =
                        delta > 0
                            ? midChange > heelChange && midChange < foreChange
                            : midChange < heelChange && midChange > foreChange;
                    if (!towardFore) {
                        failures.push(
                            `${label}: taper heel ${heelChange.toFixed(2)} mid ${midChange.toFixed(2)} fore ${foreChange.toFixed(2)}`,
                        );
                    }
                    const ballScale = shoeWidthScaleAtU(
                        ref.forefootU,
                        ref.ballWidthMm,
                        ref.heelWidthMm,
                        width,
                    );
                    const heelScale = shoeWidthScaleAtU(ref.heelU, ref.ballWidthMm, ref.heelWidthMm, width);
                    if (Math.abs(ballScale - (ref.ballWidthMm + delta) / ref.ballWidthMm) > 1e-6) {
                        failures.push(`${label}: forefoot scale is not the default-width scale`);
                    }
                    if (Math.abs(heelScale - ballScale) < 1e-4) {
                        failures.push(`${label}: heel scale equals the forefoot scale`);
                    }
                }

                let prev = shoeWidthScaleAtU(0, ref.ballWidthMm, ref.heelWidthMm, width);
                for (let u = 0.02; u <= 1; u += 0.02) {
                    const s = shoeWidthScaleAtU(u, ref.ballWidthMm, ref.heelWidthMm, width);
                    if (delta > 0 ? s + 1e-9 < prev : s - 1e-9 > prev) {
                        failures.push(`${label}: scale not monotonic at u=${u.toFixed(2)}`);
                        break;
                    }
                    prev = s;
                }

                for (const u of stations) {
                    const x = ref.frame.minX + u * ref.frame.lengthMm;
                    const meshEdge = edgesAt(topOutline.points, x);
                    const ringEdge = edgesAt(scaledOutline, x);
                    const botEdge = edgesAt(bottom, x);
                    if (!meshEdge || !ringEdge || !botEdge) continue;
                    if (Math.abs(ringEdge.lo - meshEdge.lo) > 1 || Math.abs(ringEdge.hi - meshEdge.hi) > 1) {
                        failures.push(
                            `${label} u=${u.toFixed(2)} outline off top lo=${(ringEdge.lo - meshEdge.lo).toFixed(2)} hi=${(ringEdge.hi - meshEdge.hi).toFixed(2)}`,
                        );
                    }
                    const outsideLo = Math.max(0, meshEdge.lo - botEdge.lo);
                    const outsideHi = Math.max(0, botEdge.hi - meshEdge.hi);
                    if (outsideLo > 1 || outsideHi > 1) {
                        failures.push(
                            `${label} u=${u.toFixed(2)} bottom outside lo=${outsideLo.toFixed(2)} hi=${outsideHi.toFixed(2)}`,
                        );
                    }
                }

                const sampleIndex = pattern.findIndex((p) => Math.abs(p.y - ref.frame.yMid) > 5);
                const sample = sampleIndex >= 0 ? pattern[sampleIndex] : undefined;
                const scaledSample = sampleIndex >= 0 ? bottom[sampleIndex] : undefined;
                if (sample && scaledSample) {
                    const u = (sample.x - ref.frame.minX) / ref.frame.lengthMm;
                    const s = shoeWidthScaleAtU(u, ref.ballWidthMm, ref.heelWidthMm, width);
                    const expected = ref.frame.yMid + (sample.y - ref.frame.yMid) * s;
                    if (Math.abs(scaledSample.y - expected) > 1e-4) {
                        failures.push(`${label}: bottom point did not use the top scale`);
                    }
                }

                if (top !== raw) top.dispose();
            }
        }
        raw.dispose();
        expect(failures).toEqual([]);
    }, 180_000);
});
