// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import {
    applyShoeWidthToGeometry,
    applyShoeWidthToPoints,
    type ShoeWidthId,
    shoeWidthFrameOfGeometry,
} from "@/lib/geometry/shoe-width";
import { extractMeshOutline } from "@/lib/geometry/trimline";
import { defaultDesign } from "@/stores/design-store";
import { baseModifierField } from "./base-asset";
import { bottomPatternWidthCenter, viewerBottomPatternPlanform } from "./bottom-planform-width";
import { composePrintSolidTop } from "./procedural-wall/print-solid-compose";
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
const HEELS = [0, 2, -2];

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

describe("bottom pattern planform matches the width-scaled top mesh", () => {
    test("Medium planform is the unscaled pattern (byte-identical width step)", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        primeSampleTopGeometry(
            await sampleTopFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            ),
        );
        const raw = await loadSampleTopGeometry();
        const pattern = buildProceduralViewerPattern(raw, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        const frame = shoeWidthFrameOfGeometry(raw);
        for (const size of SIZES) {
            const layout = insoleLayoutForUsMenSize(size);
            const opts = {
                ballWidthMm: layout.widthMm,
                heelWidthMm: layout.widthMm * 0.62,
                heelCupWidthMm: 0,
            };
            const center = bottomPatternWidthCenter(raw, "medium", frame, opts);
            const out = viewerBottomPatternPlanform(pattern, "medium", frame, opts, center);
            expect(out).toBe(pattern);
            const legacy = applyShoeWidthToPoints(pattern, "medium", {
                ballWidthMm: opts.ballWidthMm,
                heelWidthMm: opts.heelWidthMm,
                minX: frame.minX,
                lengthMm: frame.lengthMm,
            });
            expect(legacy).toBe(pattern);
        }
        raw.dispose();
    }, 120_000);

    test("Narrow through 2X Wide stay inside the top mesh at M6 and M10, including heel ±2 mm", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        primeSampleTopGeometry(
            await sampleTopFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            ),
        );
        const raw = await loadSampleTopGeometry();
        const fromRaw = buildProceduralViewerPattern(raw, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        const mediumDesign = defaultDesign();
        const mediumField = baseModifierField(mediumDesign, "left", mediumDesign.thicknessMm);
        const mediumLayout = insoleLayoutForUsMenSize(mediumDesign.usMenSize);
        const mediumTop = await composePrintSolidTop(raw.clone(), {
            sourceField: mediumField,
            shoeWidth: {
                width: "medium",
                ballWidthMm: mediumLayout.widthMm,
                heelWidthMm: mediumLayout.widthMm * 0.62,
                heelOverrideMm: 0,
            },
        });
        const fromCompose = buildProceduralViewerPattern(mediumTop, "full_contact", {
            heelCupWidthMm: 0,
            forefootWidthMm: 0,
        });
        if (mediumTop !== raw) mediumTop.dispose();
        expect(fromCompose.length).toBe(fromRaw.length);
        let patternDrift = 0;
        for (let i = 0; i < fromRaw.length; i++) {
            const a = fromCompose[i];
            const b = fromRaw[i];
            if (!a || !b) continue;
            patternDrift = Math.max(patternDrift, Math.hypot(a.x - b.x, a.y - b.y));
        }
        expect(patternDrift).toBeLessThan(0.05);
        const native = fromCompose;
        const frame = shoeWidthFrameOfGeometry(raw);
        const failures: string[] = [];
        const neutralLayout = insoleLayoutForUsMenSize(9);
        const mediumOpts = {
            ballWidthMm: neutralLayout.widthMm,
            heelWidthMm: neutralLayout.widthMm * 0.62,
            heelCupWidthMm: 0,
        };
        const mediumCenter = bottomPatternWidthCenter(raw, "medium", frame, mediumOpts);
        const mediumPattern = viewerBottomPatternPlanform(native, "medium", frame, mediumOpts, mediumCenter);
        const mediumMesh = extractMeshOutline(raw, 80);
        expect(mediumMesh).toBeTruthy();

        for (const size of SIZES) {
            for (const width of WIDTHS) {
                for (const heel of HEELS) {
                    const layout = insoleLayoutForUsMenSize(size);
                    const opts = {
                        ballWidthMm: layout.widthMm,
                        heelWidthMm: layout.widthMm * 0.62,
                        heelCupWidthMm: heel,
                    };
                    const center = bottomPatternWidthCenter(raw, width, frame, opts);
                    const bottom = viewerBottomPatternPlanform(native, width, frame, opts, center);
                    const design = defaultDesign();
                    design.usMenSize = size;
                    design.shoeWidth = width;
                    design.corrections.left.heelCupWidthMm = heel;
                    design.corrections.right.heelCupWidthMm = heel;
                    const field = baseModifierField(design, "left", design.thicknessMm);
                    const shoe = {
                        width,
                        ballWidthMm: layout.widthMm,
                        heelWidthMm: layout.widthMm * 0.62,
                        heelOverrideMm: heel,
                    };
                    const topGeo =
                        heel === 0
                            ? applyShoeWidthToGeometry(raw, width, shoe)
                            : await composePrintSolidTop(raw.clone(), {
                                  sourceField: field,
                                  shoeWidth: shoe,
                              });
                    const top = extractMeshOutline(topGeo, 80);
                    if (topGeo !== raw) topGeo.dispose();
                    if (!top) {
                        failures.push(`M${size} ${width} heel ${heel}: no top outline`);
                        continue;
                    }
                    const label = `M${size} ${width} heel ${heel}`;
                    const stations: number[] = [];
                    for (let i = 1; i < 20; i++) stations.push(i / 20);
                    let foreU = 0.68;
                    let foreTopW = -1;
                    let foreBotW = -1;
                    for (const u of stations) {
                        const x = frame.minX + u * frame.lengthMm;
                        const meshEdge = edgesAt(top.points, x);
                        const botEdge = edgesAt(bottom, x);
                        const medMesh = mediumMesh ? edgesAt(mediumMesh.points, x) : null;
                        const medBot = edgesAt(mediumPattern, x);
                        if (!meshEdge || !botEdge || !medMesh || !medBot) continue;
                        const outsideLo = Math.max(0, meshEdge.lo - botEdge.lo);
                        const outsideHi = Math.max(0, botEdge.hi - meshEdge.hi);
                        if (outsideLo > 1 || outsideHi > 1) {
                            failures.push(
                                `${label} u=${u.toFixed(2)} outside lo=${outsideLo.toFixed(2)} hi=${outsideHi.toFixed(2)}`,
                            );
                        }
                        const dLo = Math.abs(botEdge.lo - medBot.lo - (meshEdge.lo - medMesh.lo));
                        const dHi = Math.abs(botEdge.hi - medBot.hi - (meshEdge.hi - medMesh.hi));
                        if (u >= 0.62 && u <= 0.75 && (dLo > 1 || dHi > 1)) {
                            failures.push(
                                `${label} u=${u.toFixed(2)} edge drift lo=${dLo.toFixed(2)} hi=${dHi.toFixed(2)}`,
                            );
                        }
                        if (u >= 0.62 && u <= 0.75 && meshEdge.width > foreTopW) {
                            foreTopW = meshEdge.width;
                            foreBotW = botEdge.width;
                            foreU = u;
                        }
                    }
                    if (foreTopW < 0) {
                        failures.push(`${label}: no forefoot station`);
                        continue;
                    }
                    const widthGap = foreBotW - foreTopW;
                    if (widthGap > 1) {
                        failures.push(
                            `${label} forefoot u=${foreU.toFixed(2)} bottom wider by ${widthGap.toFixed(2)} mm`,
                        );
                    }
                    const medX = frame.minX + foreU * frame.lengthMm;
                    const medTop = mediumMesh ? edgesAt(mediumMesh.points, medX) : null;
                    const medBot = edgesAt(mediumPattern, medX);
                    if (medTop && medBot) {
                        const deltaTop = foreTopW - medTop.width;
                        const deltaBot = foreBotW - medBot.width;
                        if (Math.abs(deltaBot - deltaTop) > 1) {
                            failures.push(
                                `${label} forefoot width delta bot=${deltaBot.toFixed(2)} top=${deltaTop.toFixed(2)}`,
                            );
                        }
                    }
                }
            }
        }
        raw.dispose();
        expect(failures).toEqual([]);
    }, 180_000);

    test("a second affine on the already-scaled pattern is the wing this fix removes", () => {
        const pts = [
            { x: 0, y: -40 },
            { x: 180, y: -48 },
            { x: 270, y: -10 },
            { x: 180, y: 48 },
            { x: 0, y: 40 },
        ];
        const frame = { minX: 0, lengthMm: 270, yMid: 0 };
        const opts = { ballWidthMm: 86, heelWidthMm: 86 * 0.62, heelCupWidthMm: 0 };
        const once = viewerBottomPatternPlanform(pts, "xx_wide", frame, opts, 0);
        const twice = applyShoeWidthToPoints(once, "xx_wide", {
            ballWidthMm: opts.ballWidthMm,
            heelWidthMm: opts.heelWidthMm,
            minX: frame.minX,
            lengthMm: frame.lengthMm,
            yMid: frame.yMid,
        });
        const ball = edgesAt(once, 180);
        const winged = edgesAt(twice, 180);
        expect(ball && winged && winged.width > ball.width + 5).toBe(true);
    });
});
