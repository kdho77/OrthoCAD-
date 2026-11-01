// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BoxGeometry, BufferAttribute, BufferGeometry } from "three";
import { generateCncJob } from "@/lib/cnc/export";
import { cloneProfile } from "@/lib/cnc/profile";
import { buildExportGlbGeometry } from "@/lib/geometry/export-geometry";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { packHardness3mf } from "@/lib/hardness/export-3mf";
import { canonicalizeJson, sha256Utf8 } from "@/lib/hardness/hash";
import {
    paintAsymmetricFootImage,
    SYNTHETIC_MEDIAL_INK_UV,
    syntheticAsymmetricPressureFoot,
} from "@/lib/pressure-map/asymmetric-fixture";
import { PRESSURE_MAP_MAX_DATA_URL_CHARS, PRESSURE_MAP_MAX_EDGE_PX } from "@/lib/pressure-map/constants";
import { detectContentBoundsFromRgba, keyNearWhiteBackground } from "@/lib/pressure-map/content-bounds";
import { designStateForManufacturingExport } from "@/lib/pressure-map/export-strip";
import { loadPressureMapFixturePng } from "@/lib/pressure-map/fixture-loader";
import { analyzeFromRgba } from "@/lib/pressure-map/orientation";
import { meshLocalTopOutline, pointInPolygon } from "@/lib/pressure-map/outline-clip";
import { countPixelsOutsideMask, dilateMask } from "@/lib/pressure-map/overlay-pixels";
import {
    autoPressureMapPlacement,
    footprintMedialY,
    footprintMmFromImageUv,
    footprintPointToCanvasPx,
    footprintRectForDesign,
    medialSign,
    pressureMapMeshPose,
} from "@/lib/pressure-map/placement";
import { renderPressureMapPreviewPngs, writePreviewArtifacts } from "@/lib/pressure-map/render-preview";
import { medialFootprintSign } from "@/lib/pressure-map/types";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState, PressureMapFoot, Side } from "@/types";
import { syntheticWorkpiece } from "../../../../tests/cnc/helpers";

function designWithPressureMaps(): DesignState {
    return {
        ...defaultDesign(),
        pressureMaps: {
            left: syntheticAsymmetricPressureFoot("left", "left"),
            right: syntheticAsymmetricPressureFoot("right", "right"),
        },
    };
}

describe("pressure map overlay", () => {
    test("analyze detects synthetic left/right anatomical side", () => {
        for (const side of ["left", "right"] as Side[]) {
            const rgba = paintAsymmetricFootImage(side);
            const o = analyzeFromRgba(rgba, 240, 400, side);
            expect(o.detectedImageSide).toBe(side);
            expect(o.oppositeFootMirror).toBe(false);
        }
    });

    test("detectContentBounds ignores white margins", () => {
        const bounds = detectContentBoundsFromRgba(
            100,
            200,
            (() => {
                const rgba = new Uint8ClampedArray(100 * 200 * 4);
                for (let i = 0; i < rgba.length; i += 4) {
                    rgba[i] = 255;
                    rgba[i + 1] = 255;
                    rgba[i + 2] = 255;
                    rgba[i + 3] = 255;
                }
                for (let y = 80; y < 120; y++) {
                    for (let x = 40; x < 60; x++) {
                        const i = (y * 100 + x) * 4;
                        rgba[i] = 10;
                        rgba[i + 1] = 10;
                        rgba[i + 2] = 200;
                    }
                }
                return rgba;
            })(),
        );
        expect(bounds.minU).toBeGreaterThan(0.35);
        expect(bounds.maxU).toBeLessThan(0.65);
    });

    test("documents import downscale caps", () => {
        expect(PRESSURE_MAP_MAX_EDGE_PX).toBe(1024);
        expect(PRESSURE_MAP_MAX_DATA_URL_CHARS).toBeGreaterThan(500_000);
    });

    test("medialFootprintSign matches height-field convention", () => {
        expect(medialFootprintSign("left")).toBe(-1);
        expect(medialFootprintSign("right")).toBe(1);
    });

    test("matching foot imports do not mirror; opposite foot does", () => {
        const leftOnLeft = syntheticAsymmetricPressureFoot("left", "left");
        const rightOnRight = syntheticAsymmetricPressureFoot("right", "right");
        expect(leftOnLeft.orientation?.oppositeFootMirror).toBe(false);
        expect(rightOnRight.orientation?.oppositeFootMirror).toBe(false);
        const leftOnRight = syntheticAsymmetricPressureFoot("left", "right");
        expect(leftOnRight.orientation?.oppositeFootMirror).toBe(true);
        expect(
            autoPressureMapPlacement("right", footprintRectForDesign(defaultDesign(), "right"), rightOnRight)
                .mirrorImageU,
        ).toBe(false);
    });

    test("committed fixtures: heel-toe length, aspect, medial hallux, no same-side mirror", () => {
        const design = defaultDesign();
        const hallux = {
            left: { u: 0.611, v: 0.255 },
            right: { u: 0.388, v: 0.255 },
        };
        for (const side of ["left", "right"] as Side[]) {
            const foot = loadPressureMapFixturePng(side, `${side}_foot_pressure.png`);
            expect(foot.orientation?.oppositeFootMirror).toBe(false);
            expect(foot.orientation?.autoRotationDeg).toBe(-90);
            const fp = {
                minX: 0,
                maxX: 271.93,
                minY: -45.85,
                maxY: 45.85,
                centerX: 135.965,
                centerY: 0,
                lengthMm: 271.93,
                widthMm: 91.7,
            };
            const placement = autoPressureMapPlacement(side, fp, foot);
            expect(placement.mirrorImageU).toBe(false);
            expect(placement.containFit.limitedBy).toBe("width");
            expect(placement.containFit.widthRatio).toBeCloseTo(1, 3);
            expect(placement.containFit.lengthRatio).toBeLessThan(1);
            expect(placement.containFit.lengthRatio).toBeGreaterThan(0.9);
            expect(placement.sizeFootprint.x).toBeLessThanOrEqual(fp.lengthMm + 1e-6);
            expect(placement.sizeFootprint.y).toBeLessThanOrEqual(fp.widthMm + 1e-6);
            expect(placement.sizeFootprint.y).toBeCloseTo(fp.widthMm, 3);
            const du = foot.contentBounds.maxU - foot.contentBounds.minU;
            const dv = foot.contentBounds.maxV - foot.contentBounds.minV;
            const aspect = (dv * foot.imageHeight) / (du * foot.imageWidth);
            expect(placement.sizeFootprint.x / placement.sizeFootprint.y).toBeCloseTo(aspect, 3);
            expect(placement.planeScale.y).toBeCloseTo(placement.sizeFootprint.x);
            expect(placement.planeScale.x).toBeCloseTo(placement.sizeFootprint.y);
            const mid = footprintPointToCanvasPx(fp.centerX, fp.centerY, placement, 100, 200);
            expect(mid.x).toBeCloseTo(50, 3);
            expect(mid.y).toBeCloseTo(100, 3);
            const toe = footprintPointToCanvasPx(
                fp.centerX + placement.sizeFootprint.x / 2,
                fp.centerY,
                placement,
                100,
                200,
            );
            expect(toe.y).toBeLessThan(2);
            expect(toe.x).toBeGreaterThan(40);
            expect(toe.x).toBeLessThan(60);
            const medial = footprintPointToCanvasPx(
                fp.centerX,
                fp.centerY + medialSign(side) * (placement.sizeFootprint.y / 2),
                placement,
                100,
                200,
            );
            if (side === "left") expect(medial.x).toBeGreaterThan(98);
            else expect(medial.x).toBeLessThan(2);
            const pt = footprintMmFromImageUv(hallux[side].u, hallux[side].v, side, foot, placement);
            expect(Math.sign(pt.y - fp.centerY)).toBe(medialSign(side));
            expect(pt.x).toBeGreaterThan(fp.centerX);
            const pose = pressureMapMeshPose(design, side, foot);
            expect(pose.position.z).toBeLessThan(2);
            expect(pose.scale.y).toBeGreaterThan(pose.scale.x);
        }
    });

    test("asymmetric images: medial arch under insole medial on both feet", () => {
        const design = defaultDesign();
        for (const side of ["left", "right"] as Side[]) {
            const foot = syntheticAsymmetricPressureFoot(side, side);
            const fp = footprintRectForDesign(design, side);
            const placement = autoPressureMapPlacement(side, fp, foot);
            const ink = SYNTHETIC_MEDIAL_INK_UV[side];
            const pt = footprintMmFromImageUv(ink.u, ink.v, side, foot, placement);
            expect(Math.sign(pt.y - fp.centerY)).toBe(footprintMedialY(side));
        }
    });

    test("each foot map lands under the correct foot (sideOffsetX sign)", () => {
        const design = designWithPressureMaps();
        const layout = insoleLayoutFromDesign(design);
        for (const side of ["left", "right"] as Side[]) {
            const foot = design.pressureMaps![side]!;
            const pose = pressureMapMeshPose(design, side, foot);
            expect(Math.sign(pose.position.y)).toBe(Math.sign(sideOffsetX(side, layout.widthMm)));
        }
    });

    test("manual alignment persists on patch", () => {
        useDesignStore.setState({ design: defaultDesign() });
        const foot = syntheticAsymmetricPressureFoot("left", "left");
        useDesignStore.getState().setPressureMap("left", foot);
        useDesignStore.getState().patchPressureMapAlignment("left", {
            offsetMm: { x: 3, y: -2 },
            scale: 1.1,
            rotationDeg: 5,
        });
        const saved = useDesignStore.getState().design.pressureMaps?.left?.alignment;
        expect(saved?.offsetMm.x).toBe(3);
        expect(saved?.offsetMm.y).toBe(-2);
        expect(saved?.scale).toBeCloseTo(1.1);
        expect(saved?.rotationDeg).toBe(5);
    });

    test("STL export bytes unchanged with pressure maps on design", () => {
        const geo = new BoxGeometry(260, 95, 8);
        const before = geometryToBinarySTL(geo);
        useDesignStore.setState({ design: designWithPressureMaps() });
        const after = geometryToBinarySTL(geo);
        expect(Buffer.from(before)).toEqual(Buffer.from(after));
        geo.dispose();
    });

    test("GLB geometry unchanged with pressure maps on design", async () => {
        useDesignStore.setState({ design: defaultDesign() });
        const before = await buildExportGlbGeometry("left");
        const beforePos = before.getAttribute("position")!.array.slice();
        useDesignStore.setState({ design: designWithPressureMaps() });
        const after = await buildExportGlbGeometry("left");
        expect(after.getAttribute("position")!.array).toEqual(beforePos);
        before.dispose();
        after.dispose();
    });

    test("3MF design hash unchanged when pressure maps present", async () => {
        const design = defaultDesign();
        const shell = {
            positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
            indices: new Uint32Array([0, 1, 2]),
        };
        const base = await packHardness3mf({ design, side: "left", shell, modifiers: [] });
        const withMaps = await packHardness3mf({
            design: designWithPressureMaps(),
            side: "left",
            shell,
            modifiers: [],
        });
        expect(withMaps.designHash).toBe(base.designHash);
        expect(withMaps.bytes).toEqual(base.bytes);
    });

    test("manufacturing export JSON strips pressureMaps", () => {
        const stripped = designStateForManufacturingExport(designWithPressureMaps());
        expect(stripped.pressureMaps).toBeUndefined();
        const hashBefore = sha256Utf8(canonicalizeJson({ side: "left", design: stripped }));
        const hashWith = sha256Utf8(
            canonicalizeJson({ side: "left", design: designStateForManufacturingExport(defaultDesign()) }),
        );
        expect(hashBefore).toBe(hashWith);
    });

    test("CNC G-code unchanged with pressure maps loaded", () => {
        useDesignStore.setState({ design: designWithPressureMaps() });
        const profile = cloneProfile();
        const a = generateCncJob(profile, [syntheticWorkpiece(profile, "left")]);
        useDesignStore.setState({ design: defaultDesign() });
        const b = generateCncJob(profile, [syntheticWorkpiece(profile, "left")]);
        expect(a.gcode).toBe(b.gcode);
        expect(a.designHash).toBe(b.designHash);
    });

    test("near-white background keys to alpha and saturated ink stays", () => {
        const rgba = new Uint8ClampedArray([
            255, 255, 255, 255, 250, 248, 249, 255, 40, 30, 220, 255, 220, 40, 30, 255, 240, 240, 240, 255,
        ]);
        keyNearWhiteBackground(rgba);
        expect(rgba[3]).toBe(0);
        expect(rgba[7]).toBe(0);
        expect(rgba[11]).toBe(255);
        expect(rgba[15]).toBe(255);
        expect(rgba[19]).toBe(0);
    });

    test("top outline follows a concave footprint and excludes the notch", () => {
        const geo = new BufferGeometry();
        const z = 1;
        const positions = new Float32Array([
            0,
            0,
            z,
            10,
            0,
            z,
            10,
            4,
            z,
            0,
            0,
            z,
            10,
            4,
            z,
            0,
            4,
            z,
            0,
            4,
            z,
            4,
            4,
            z,
            4,
            10,
            z,
            0,
            4,
            z,
            4,
            10,
            z,
            0,
            10,
            z,
        ]);
        geo.setAttribute("position", new BufferAttribute(positions, 3));
        const loop = meshLocalTopOutline(geo, 0.35);
        expect(loop.length).toBeGreaterThan(8);
        expect(pointInPolygon(2, 2, loop)).toBe(true);
        expect(pointInPolygon(2, 8, loop)).toBe(true);
        expect(pointInPolygon(8, 8, loop)).toBe(false);
        expect(pointInPolygon(-1, 2, loop)).toBe(false);
        geo.dispose();
    });

    test("outside-mask counter ignores insole pixels and flags overlay spill", () => {
        const width = 6;
        const height = 4;
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < rgba.length; i += 4) {
            rgba[i] = 12;
            rgba[i + 1] = 17;
            rgba[i + 2] = 27;
            rgba[i + 3] = 255;
        }
        const mask = new Uint8Array(width * height);
        mask[1 * width + 2] = 1;
        const dilated = dilateMask(mask, width, height, 1);
        const setPx = (x: number, y: number, r: number, g: number, b: number) => {
            const i = ((height - 1 - y) * width + x) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
        };
        setPx(2, 1, 248, 250, 252);
        setPx(0, 0, 30, 40, 220);
        const counted = countPixelsOutsideMask(rgba, dilated, width, height, { r: 12, g: 17, b: 27 }, 22);
        expect(counted.insideVarying).toBeGreaterThan(0);
        expect(counted.outside).toBe(1);
    });

    test("writes software preview PNGs when PRESSURE_MAP_SOFTWARE_PREVIEW=1", () => {
        if (process.env.PRESSURE_MAP_SOFTWARE_PREVIEW !== "1") return;
        const dirs = [
            resolve("/opt/cursor/artifacts/screenshots"),
            resolve(process.cwd(), "tests/pressure-map/previews"),
        ];
        const design = designWithPressureMaps();
        for (const side of ["left", "right"] as Side[]) {
            const foot = design.pressureMaps![side]!;
            const w = foot.imageWidth;
            const h = foot.imageHeight;
            const rgba = paintAsymmetricFootImage(side, w, h);
            const { top, oblique } = renderPressureMapPreviewPngs({
                design,
                side,
                foot,
                rgba,
                imageWidth: w,
                imageHeight: h,
            });
            expect(top.length).toBeGreaterThan(8_000);
            writePreviewArtifacts(side, top, oblique, dirs);
        }
    });
});
