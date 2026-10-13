// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { Vector3 } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import type { PlacedElement, SideCorrections } from "@/types";
import { composePrintSolidTop } from "./print-solid-compose";
import { sampleTopFromArrayBuffer } from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zero(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(patch: Partial<HeightFieldParams> = {}): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements: [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
        ...patch,
    };
}

async function loadSampleTop() {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function bbox(geo: {
    getAttribute: (n: string) =>
        | {
              count: number;
              getX: (i: number) => number;
              getY: (i: number) => number;
              getZ: (i: number) => number;
          }
        | undefined;
}) {
    const pos = geo.getAttribute("position");
    if (!pos) throw new Error("no position");
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
        minZ = Math.min(minZ, pos.getZ(i));
        maxZ = Math.max(maxZ, pos.getZ(i));
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, count: pos.count };
}

describe("composePrintSolidTop", () => {
    test("width affine widens the ball and leaves X unchanged", async () => {
        const raw = await loadSampleTop();
        const native = bbox(raw);
        const composed = composePrintSolidTop(raw, {
            sourceField: field(),
            shoeWidth: {
                width: "wide",
                ballWidthMm: native.maxY - native.minY,
                heelWidthMm: (native.maxY - native.minY) * 0.62,
            },
        });
        const out = bbox(composed);
        expect(out.maxX - out.minX).toBeCloseTo(native.maxX - native.minX, 3);
        expect(out.maxY - out.minY).toBeGreaterThan(native.maxY - native.minY + 2);
        composed.dispose();
        raw.dispose();
    }, 30_000);

    test("Kirby medial skive raises the medial heel vs the unmodified top", async () => {
        const raw = await loadSampleTop();
        const native = bbox(raw);
        const length = native.maxX - native.minX;
        const plain = composePrintSolidTop(raw, { sourceField: field() });
        const skived = composePrintSolidTop(raw, {
            sourceField: field({ corrections: { ...zero(), medialSkiveMm: 4 } }),
        });
        const a = plain.getAttribute("position")!;
        const b = skived.getAttribute("position")!;
        let maxRaise = 0;
        for (let i = 0; i < a.count; i++) {
            const u = (a.getX(i) - native.minX) / length;
            const y = a.getY(i);
            if (u > 0.28 || y > 0) continue;
            maxRaise = Math.max(maxRaise, b.getZ(i) - a.getZ(i));
        }
        expect(maxRaise).toBeGreaterThan(0.4);
        plain.dispose();
        skived.dispose();
        raw.dispose();
    }, 30_000);

    test("trimline clip runs before rim extraction and drops exterior triangles", async () => {
        const raw = await loadSampleTop();
        const native = bbox(raw);
        const cx = (native.minX + native.maxX) / 2;
        const cy = (native.minY + native.maxY) / 2;
        const rx = (native.maxX - native.minX) * 0.28;
        const ry = (native.maxY - native.minY) * 0.28;
        const points = Array.from({ length: 24 }, (_, i) => {
            const t = (i / 24) * Math.PI * 2;
            return new Vector3(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, 0);
        });
        const composed = composePrintSolidTop(raw, {
            sourceField: field(),
            trimline: { points },
        });
        const out = bbox(composed);
        expect(out.count).toBeLessThan(native.count * 0.85);
        expect(out.maxX - out.minX).toBeLessThan((native.maxX - native.minX) * 0.8);
        composed.dispose();
        raw.dispose();
    }, 30_000);

    test("elements raise via elementHeightAt (includeElements)", async () => {
        const raw = await loadSampleTop();
        const native = bbox(raw);
        const el: PlacedElement = {
            id: "met-1",
            kind: "met_pad",
            side: "left",
            position: { x: 20, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 5,
        };
        const plain = composePrintSolidTop(raw, { sourceField: field() });
        const withEl = composePrintSolidTop(raw, {
            sourceField: field({
                lengthMm: native.maxX - native.minX,
                widthMm: native.maxY - native.minY,
                elements: [el],
            }),
        });
        const a = plain.getAttribute("position")!;
        const b = withEl.getAttribute("position")!;
        let maxRaise = 0;
        for (let i = 0; i < a.count; i++) maxRaise = Math.max(maxRaise, b.getZ(i) - a.getZ(i));
        expect(maxRaise).toBeGreaterThan(0.3);
        plain.dispose();
        withEl.dispose();
        raw.dispose();
    }, 30_000);
});
