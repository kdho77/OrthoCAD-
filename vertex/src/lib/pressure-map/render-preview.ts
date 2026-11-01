// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    autoPressureMapPlacement,
    footprintMedialY,
    footprintRectForDesign,
    pressureMapMeshPose,
} from "@/lib/pressure-map/placement";
import type { DesignState, PressureMapFoot, Side } from "@/types";
import { encodePng } from "../../../../tests/helpers/render-png";

function sampleRgba(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    u: number,
    v: number,
): [number, number, number] {
    const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
    const i = (y * w + x) * 4;
    return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
}

function footprintFromPlanePixel(
    px: number,
    py: number,
    width: number,
    height: number,
    pose: ReturnType<typeof pressureMapMeshPose>,
    layoutLength: number,
): { fx: number; fy: number } | null {
    const nx = (px / width) * 2 - 1;
    const ny = (py / height) * 2 - 1;
    const halfL = pose.scale.x / 2;
    const halfW = pose.scale.y / 2;
    const lx = nx * halfL;
    const ly = ny * halfW;
    const c = Math.cos(-pose.rotation.z);
    const s = Math.sin(-pose.rotation.z);
    const rx = c * lx - s * ly;
    const ry = s * lx + c * ly;
    if (Math.abs(rx) > halfL || Math.abs(ry) > halfW) return null;
    const u = (rx / halfL) * 0.5 + 0.5;
    const v = (ry / halfW) * 0.5 + 0.5;
    return { fx: u * layoutLength, fy: ry };
}

/**
 * Software top + oblique composite: pressure map from RGBA + semi-transparent insole footprint.
 */
export function renderPressureMapPreviewPngs(options: {
    design: DesignState;
    side: Side;
    foot: PressureMapFoot;
    rgba: Uint8ClampedArray;
    imageWidth: number;
    imageHeight: number;
}): { top: Uint8Array; oblique: Uint8Array } {
    const { design, side, foot, rgba, imageWidth, imageHeight } = options;
    const footprint = footprintRectForDesign(design, side);
    const placement = autoPressureMapPlacement(side, footprint, foot, foot.alignment);
    const pose = pressureMapMeshPose(design, side, foot);
    const orient = foot.orientation ?? {
        detectedImageSide: side,
        autoRotationDeg: -90,
        oppositeFootMirror: false,
    };

    const top = renderView({
        width: 960,
        height: 720,
        design,
        side,
        foot,
        rgba,
        imageWidth,
        imageHeight,
        footprint,
        placement,
        pose,
        orient,
        oblique: false,
    });
    const oblique = renderView({
        width: 960,
        height: 720,
        design,
        side,
        foot,
        rgba,
        imageWidth,
        imageHeight,
        footprint,
        placement,
        pose,
        orient,
        oblique: true,
    });
    return { top, oblique };
}

function renderView(ctx: {
    width: number;
    height: number;
    design: DesignState;
    side: Side;
    foot: PressureMapFoot;
    rgba: Uint8ClampedArray;
    imageWidth: number;
    imageHeight: number;
    footprint: ReturnType<typeof footprintRectForDesign>;
    placement: ReturnType<typeof autoPressureMapPlacement>;
    pose: ReturnType<typeof pressureMapMeshPose>;
    orient: NonNullable<PressureMapFoot["orientation"]>;
    oblique: boolean;
}): Uint8Array {
    const { width, height, rgba, imageWidth, imageHeight, footprint, placement, orient, oblique } = ctx;
    const rgb = new Uint8Array(width * height * 3);
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const i = (py * width + px) * 3;
            rgb[i] = 12;
            rgb[i + 1] = 17;
            rgb[i + 2] = 27;
            const u = px / width;
            const v = py / height;
            const fx = footprint.minX + u * footprint.lengthMm;
            const fy = footprint.minY + (oblique ? 0.35 : 1) * (v * footprint.widthMm + (1 - v) * 0);
            const fy2 = footprint.centerY + (v - 0.5) * footprint.widthMm * (oblique ? 0.75 : 1);

            const planeU =
                (fx - (placement.centerFootprint.x - placement.sizeFootprint.x / 2)) /
                placement.sizeFootprint.x;
            const medialY = footprintMedialY(ctx.side);
            const planeV = (medialY * (fy2 - placement.centerFootprint.y)) / placement.sizeFootprint.y + 0.5;

            if (planeU >= 0 && planeU <= 1 && planeV >= 0 && planeV <= 1) {
                let tu = planeU;
                const tv = planeV;
                if (orient.oppositeFootMirror) tu = 1 - tu;
                const rot = -((orient.autoRotationDeg + ctx.foot.alignment.rotationDeg) * Math.PI) / 180;
                const pu = tu - 0.5;
                const pv = tv - 0.5;
                const c = Math.cos(rot);
                const s = Math.sin(rot);
                const iu = c * pu + s * pv + 0.5;
                const iv = -s * pu + c * pv + 0.5;
                if (iu >= 0 && iu <= 1 && iv >= 0 && iv <= 1) {
                    const [r, g, b] = sampleRgba(rgba, imageWidth, imageHeight, iu, iv);
                    rgb[i] = r;
                    rgb[i + 1] = g;
                    rgb[i + 2] = b;
                }
            }

            const insoleU = fx / footprint.lengthMm;
            const insoleV = (fy2 - footprint.minY) / footprint.widthMm;
            if (insoleU > 0.05 && insoleU < 0.95 && insoleV > 0.12 && insoleV < 0.88) {
                const edge = Math.min(insoleU - 0.05, 0.95 - insoleU, insoleV - 0.12, 0.88 - insoleV);
                const alpha = Math.min(0.55, edge * 8);
                rgb[i] = Math.floor(rgb[i]! * (1 - alpha) + 248 * alpha);
                rgb[i + 1] = Math.floor(rgb[i + 1]! * (1 - alpha) + 250 * alpha);
                rgb[i + 2] = Math.floor(rgb[i + 2]! * (1 - alpha) + 252 * alpha);
            }
        }
    }
    return encodePng(width, height, rgb);
}

export function writePreviewArtifacts(
    side: Side,
    top: Uint8Array,
    oblique: Uint8Array,
    dirs: string[],
): void {
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    for (const dir of dirs) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `pressure-map-${side}-top.png`), top);
        writeFileSync(resolve(dir, `pressure-map-${side}-oblique.png`), oblique);
        writeFileSync(resolve(dir, `pressure-map-${side}-transparent-overlay.png`), top);
    }
}
