// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { notchAssetMm, notchOffsetAppMm, notchUvFromMm, sidecarAnchorUV } from "./sizing";
import { type ElementAssetSidecar, sidecarFeatherKey } from "./types";

function readSidecar(name: string): ElementAssetSidecar {
    const a = resolve(process.cwd(), "vertex/public/elements", name);
    const b = resolve(process.cwd(), "public/elements", name);
    const path = (() => {
        try {
            readFileSync(a);
            return a;
        } catch {
            return b;
        }
    })();
    return JSON.parse(readFileSync(path, "utf8")) as ElementAssetSidecar;
}

describe("sidecar per-edge feather and notch mm", () => {
    test("dancers_pad reads per-edge featherMm without treating it as a number", () => {
        const sc = readSidecar("new_element_2.right.json");
        expect(typeof sc.featherMm).toBe("object");
        const f = sc.featherMm as {
            distal: number;
            proximal: number;
            lateral: number;
            medialThumb: number;
            notchRim: number;
        };
        expect(f.distal).toBe(20);
        expect(f.proximal).toBe(10);
        expect(f.lateral).toBe(8);
        expect(f.medialThumb).toBe(8);
        expect(f.notchRim).toBe(3);
        expect(sc.featherProfile).toMatch(/smoothstep/);
        expect(sidecarFeatherKey(sc.featherMm)).toBe("20.00/10.00/8.00/8.00/3.00");
        expect(() => sidecarFeatherKey(sc.featherMm)).not.toThrow();
    });

    test("cluffy_wedge featherMm is 0 (no extra AABB fade)", () => {
        const sc = readSidecar("cluffy_wedge_1.right.json");
        expect(sc.featherMm).toBe(0);
        expect(sidecarFeatherKey(sc.featherMm)).toBe("0.000");
    });

    test("dancers_pad notch is placed from mm, not stale centerUV.v", () => {
        const sc = readSidecar("new_element_2.right.json");
        expect(sc.notch?.centerUV?.v).toBeCloseTo(0.6129, 4);
        expect(sc.notch?.tipFilletMm).toBe(3.5);
        expect(sc.notch?.radiusMm).toBeCloseTo(11.31, 2);

        const asset = notchAssetMm(sc);
        expect(asset).toEqual({ x: 28.57, y: 11.88 });
        const app = notchOffsetAppMm(sc);
        expect(app).toEqual({ x: 11.88, y: -28.57 });

        // Authored u matches stored centerUV.u; v from mm must not reuse 0.6129.
        const uFromMm = ((sc.notch?.centerAuthoredMm?.y ?? 0) + 1) / (sc.refSizeMm ?? 260);
        expect(uFromMm).toBeCloseTo(sc.notch?.centerUV?.u ?? 0, 3);
        expect(uFromMm).not.toBeCloseTo(0.6129, 2);
        expect(sidecarAnchorUV(sc).v).toBeCloseTo(-0.0196, 4);
        expect(sidecarAnchorUV(sc).v).not.toBeCloseTo(0.6129, 2);
    });

    test("notchUvFromMm ignores stored centerUV.v when a top mesh is supplied", async () => {
        const { sampleTopFromArrayBuffer } = await import(
            "@/lib/geometry/procedural-wall/sample-top-preview"
        );
        const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const sc = readSidecar("new_element_2.right.json");
        const uv = notchUvFromMm(raw, "right", sc);
        const leftUv = notchUvFromMm(raw, "left", sc);
        expect(uv).toBeTruthy();
        expect(leftUv).toBeTruthy();
        expect(uv!.u).toBeCloseTo(0.6953, 3);
        // The right foot's medial direction is negative app-v; the old sign
        // placed this notch on the lateral side of the foot.
        expect(uv!.v).toBeLessThan(sidecarAnchorUV(sc).v);
        expect(uv!.v).toBeCloseTo(-0.649, 2);
        expect(leftUv!.v).toBeGreaterThan(sidecarAnchorUV(sc).v);
        expect(uv!.v).not.toBe(0.6129);
        raw.dispose();
    });
});
