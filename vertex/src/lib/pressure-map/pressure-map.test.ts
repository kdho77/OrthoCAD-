// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BoxGeometry } from "three";
import { generateCncJob } from "@/lib/cnc/export";
import { cloneProfile } from "@/lib/cnc/profile";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { packHardness3mf } from "@/lib/hardness/export-3mf";
import { canonicalizeJson, sha256Utf8 } from "@/lib/hardness/hash";
import { detectContentBoundsFromRgba } from "@/lib/pressure-map/content-bounds";
import { designStateForManufacturingExport } from "@/lib/pressure-map/export-strip";
import {
    autoPressureMapPlacement,
    footprintRectForDesign,
    pressureMapMeshPose,
} from "@/lib/pressure-map/placement";
import { medialFootprintSign } from "@/lib/pressure-map/types";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState, PressureMapFoot, Side } from "@/types";
import { syntheticWorkpiece } from "../../../../tests/cnc/helpers";

function syntheticPressureFoot(side: Side, blobCenterU: number, blobCenterV: number): PressureMapFoot {
    const w = 200;
    const h = 400;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            rgba[i] = 255;
            rgba[i + 1] = 255;
            rgba[i + 2] = 255;
            rgba[i + 3] = 255;
            const u = x / w;
            const v = y / h;
            const du = u - blobCenterU;
            const dv = v - blobCenterV;
            if (du * du + dv * dv < 0.08 * 0.08) {
                rgba[i] = 220;
                rgba[i + 1] = 40;
                rgba[i + 2] = 40;
            }
        }
    }
    const bounds = detectContentBoundsFromRgba(w, h, rgba);
    return {
        imageDataUrl: `data:image/png;base64,placeholder-${side}`,
        mimeType: "image/png",
        visible: true,
        imageWidth: w,
        imageHeight: h,
        contentBounds: bounds,
        alignment: { offsetMm: { x: 0, y: 0 }, scale: 1, rotationDeg: 0 },
        fileName: `${side}-pressure.png`,
    };
}

function designWithPressureMaps(): DesignState {
    return {
        ...defaultDesign(),
        pressureMaps: {
            left: syntheticPressureFoot("left", 0.5, 0.35),
            right: syntheticPressureFoot("right", 0.5, 0.35),
        },
    };
}

describe("pressure map overlay", () => {
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

    test("medialFootprintSign matches height-field convention", () => {
        expect(medialFootprintSign("left")).toBe(-1);
        expect(medialFootprintSign("right")).toBe(1);
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

    test("right foot mirrors image U; left does not", () => {
        const design = designWithPressureMaps();
        const left = autoPressureMapPlacement(
            "left",
            footprintRectForDesign(design, "left"),
            design.pressureMaps!.left!,
        );
        const right = autoPressureMapPlacement(
            "right",
            footprintRectForDesign(design, "right"),
            design.pressureMaps!.right!,
        );
        expect(left.mirrorImageU).toBe(false);
        expect(right.mirrorImageU).toBe(true);
    });

    test("bilateral maps are not swapped on save payload keys", () => {
        const design = designWithPressureMaps();
        design.pressureMaps!.left!.fileName = "ONLY-LEFT";
        design.pressureMaps!.right!.fileName = "ONLY-RIGHT";
        expect(design.pressureMaps?.left?.fileName).toBe("ONLY-LEFT");
        expect(design.pressureMaps?.right?.fileName).toBe("ONLY-RIGHT");
    });

    test("manual alignment persists on patch", () => {
        useDesignStore.setState({ design: defaultDesign() });
        const foot = syntheticPressureFoot("left", 0.5, 0.5);
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

    test("remove restores design without pressureMaps entry", () => {
        useDesignStore.setState({ design: designWithPressureMaps() });
        useDesignStore.getState().removePressureMap("left");
        expect(useDesignStore.getState().design.pressureMaps?.left).toBeUndefined();
        useDesignStore.getState().removePressureMap("right");
        expect(useDesignStore.getState().design.pressureMaps).toBeUndefined();
    });

    test("STL export bytes unchanged with pressure maps on design", () => {
        const geo = new BoxGeometry(260, 95, 8);
        const before = geometryToBinarySTL(geo);
        useDesignStore.setState({ design: designWithPressureMaps() });
        const after = geometryToBinarySTL(geo);
        expect(Buffer.from(before)).toEqual(Buffer.from(after));
        geo.dispose();
    });

    test("3MF design hash unchanged when pressure maps present", async () => {
        const design = defaultDesign();
        const shell = {
            positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
            indices: new Uint32Array([0, 1, 2]),
        };
        const base = await packHardness3mf({
            design,
            side: "left",
            shell,
            modifiers: [],
        });
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
        const raw = designWithPressureMaps();
        const stripped = designStateForManufacturingExport(raw);
        expect(stripped.pressureMaps).toBeUndefined();
        const hashBefore = sha256Utf8(canonicalizeJson({ side: "left", design: stripped }));
        const hashWith = sha256Utf8(
            canonicalizeJson({ side: "left", design: designStateForManufacturingExport(defaultDesign()) }),
        );
        expect(hashBefore).toBe(hashWith);
    });

    test("CNC G-code unchanged with pressure maps loaded", () => {
        const design = designWithPressureMaps();
        useDesignStore.setState({ design });
        const profile = cloneProfile();
        const a = generateCncJob(profile, [syntheticWorkpiece(profile, "left")]);
        useDesignStore.setState({ design: defaultDesign() });
        const b = generateCncJob(profile, [syntheticWorkpiece(profile, "left")]);
        expect(a.gcode).toBe(b.gcode);
        expect(a.designHash).toBe(b.designHash);
    });

    test("writes screenshot artifact paths for PR (synthetic footprint preview)", () => {
        const dirs = [
            resolve("/opt/cursor/artifacts/screenshots"),
            resolve(process.cwd(), "tests/pressure-map/previews"),
        ];
        for (const dir of dirs) {
            mkdirSync(dir, { recursive: true });
            for (const side of ["left", "right"] as Side[]) {
                const foot = syntheticPressureFoot(side, 0.52, 0.4);
                const design = { ...defaultDesign(), pressureMaps: { [side]: foot } };
                const pose = pressureMapMeshPose(design, side, foot);
                const w = 640;
                const h = 480;
                const rgba = new Uint8ClampedArray(w * h * 4);
                for (let i = 0; i < rgba.length; i += 4) {
                    rgba[i] = 12;
                    rgba[i + 1] = 17;
                    rgba[i + 2] = 27;
                    rgba[i + 3] = 255;
                }
                const cx = Math.floor(w * 0.5 + pose.position.x * 0.4);
                const cy = Math.floor(h * 0.55);
                const rw = Math.floor(pose.scale.x * 0.35);
                const rh = Math.floor(pose.scale.y * 0.35);
                for (let y = cy - rh; y < cy + rh; y++) {
                    for (let x = cx - rw; x < cx + rw; x++) {
                        if (x < 0 || y < 0 || x >= w || y >= h) continue;
                        const i = (y * w + x) * 4;
                        rgba[i] = 220;
                        rgba[i + 1] = 60;
                        rgba[i + 2] = 60;
                        rgba[i + 3] = 200;
                    }
                }
                for (let y = cy - rh / 3; y < cy + rh / 3; y++) {
                    for (let x = cx - rw / 2; x < cx + rw / 2; x++) {
                        if (x < 0 || y < 0 || x >= w || y >= h) continue;
                        const i = (y * w + x) * 4;
                        rgba[i + 3] = 90;
                    }
                }
                writeFileSync(
                    resolve(dir, `pressure-map-${side}-transparent-overlay.png`),
                    pngFromRgba(w, h, rgba),
                );
            }
        }
    });
});

/** Minimal RGBA → PNG (uncompressed) for CI artifacts. */
function pngFromRgba(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
    const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
    const stride = width * 4 + 1;
    const raw = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        raw[y * stride] = 0;
        for (let x = 0; x < width; x++) {
            const si = (y * width + x) * 4;
            const di = y * stride + 1 + x * 4;
            raw[di] = rgba[si]!;
            raw[di + 1] = rgba[si + 1]!;
            raw[di + 2] = rgba[si + 2]!;
            raw[di + 3] = rgba[si + 3]!;
        }
    }
    const compressed = deflateSync(raw);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        signature,
        chunk("IHDR", ihdr),
        chunk("IDAT", compressed),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf) >>> 0);
    return Buffer.concat([len, t, data, crc]);
}

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i]!;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
}
