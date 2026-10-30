// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BufferGeometry } from "three";
import { heightmapRange } from "@/lib/cnc/heightmap";
import type { CncWorkpiece, Heightmap, MillingProfile, Point } from "@/lib/cnc/types";
import { workpieceFromGeometry } from "@/lib/cnc/workpiece";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side, SideCorrections } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

export function zeroCorrections(): SideCorrections {
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

export function field(patch: Partial<HeightFieldParams> = {}): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zeroCorrections(),
        elements: [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
        ...patch,
    };
}

export async function loadSampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function bbox(geo: BufferGeometry) {
    const pos = geo.getAttribute("position")!;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
    }
    return { minX, maxX, minY, maxY, length: maxX - minX, width: maxY - minY };
}

export function dancerPad(side: Side, lengthMm: number, widthMm: number): PlacedElement {
    return {
        id: "new_element_2",
        kind: "dancers_pad",
        side,
        ...defaultElementPose("dancers_pad", side, lengthMm, widthMm),
    };
}

export async function sampleTopWorkpiece(
    side: Side,
    profile: MillingProfile,
    withDancer: boolean,
): Promise<CncWorkpiece> {
    let raw = await loadSampleTop();
    if (side === "right") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    const b = bbox(raw);
    const composed = await composePrintSolidTop(raw, {
        sourceField: field({
            side,
            lengthMm: b.length,
            widthMm: b.width,
            elements: withDancer ? [dancerPad(side, b.length, b.width)] : [],
        }),
    });
    const wp = workpieceFromGeometry(composed, side, profile);
    if (composed !== raw) composed.dispose();
    raw.dispose();
    return wp;
}

export function syntheticWorkpiece(profile: MillingProfile, side: Side = "left"): CncWorkpiece {
    const rx = 40;
    const ry = 18;
    const n = 48;
    const outline: Point[] = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        outline.push({ x: 40 + Math.cos(a) * rx, y: Math.sin(a) * ry, z: 5 });
    }
    const cell = 0.2;
    const originX = -5;
    const originY = -25;
    const nx = Math.ceil(90 / cell);
    const ny = Math.ceil(50 / cell);
    const z = new Float32Array(nx * ny);
    const inside = new Uint8Array(nx * ny);
    z.fill(Number.NaN);
    for (let iy = 0; iy < ny; iy++) {
        const y = originY + iy * cell;
        for (let ix = 0; ix < nx; ix++) {
            const x = originX + ix * cell;
            const u = (x - 40) / rx;
            const v = y / ry;
            const r2 = u * u + v * v;
            if (r2 <= 1.08) {
                const i = iy * nx + ix;
                // Edge stays above the fillet equator (Z 6) so a true-to-surface
                // finish pass does not undercut the R5 wall. Crest is 12, edge is 8.
                z[i] = 8 + 4 * Math.max(0, 1 - r2);
                if (r2 <= 1) inside[i] = 1;
            }
        }
    }
    const hm: Heightmap = { originX, originY, cell, nx, ny, z, inside };
    const { zMin, zMax } = heightmapRange(hm);
    void profile;
    return { side, outline, heightmap: hm, zMin, zMax };
}
