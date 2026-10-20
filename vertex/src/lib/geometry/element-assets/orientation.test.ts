// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { PlacedElement } from "@/types";
import { buildElementTransform, loadTransformedAssetPositions } from "./element-asset";
import type { ElementAssetSidecar, ElementManifest } from "./types";

const directory = resolve(process.cwd(), "vertex/public/elements");
const manifest = JSON.parse(readFileSync(resolve(directory, "index.json"), "utf8")) as ElementManifest;

describe("stock GLB handedness", () => {
    for (const entry of manifest.elements) {
        test(`${entry.kind}: uses the approved left-foot source and reflects only width for right`, async () => {
            const sidecar = JSON.parse(
                readFileSync(resolve(directory, entry.sidecar), "utf8"),
            ) as ElementAssetSidecar;
            const placed: PlacedElement = {
                id: entry.id,
                kind: entry.kind,
                side: "left",
                position: { x: 25, y: -8 },
                rotationDeg: 17,
                scale: { x: 1.1, y: 0.9 },
                heightMm: 4,
            };
            const saved = JSON.stringify(placed);
            const size = { scaleAlong: 1.05, scaleAcross: 0.95 };
            const left = buildElementTransform(placed, sidecar, "left", size);
            const right = buildElementTransform({ ...placed, side: "right" }, sidecar, "right", size);
            expect(left.mirrorX).toBe(false);
            expect(right.mirrorX).toBe(true);
            expect(left.anchorUMm).toBe(25);
            expect(left.anchorVMm).toBe(-8);
            expect(left.rotationDeg).toBe(17 + sidecar.rotationDeg);
            expect({ ...right, mirrorX: false }).toEqual(left);

            const bytes = readFileSync(resolve(directory, entry.glb));
            const group = await loadGlbFromBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            );
            const merged = extractMergedGeometry(group);
            if (!merged) throw new Error(`No geometry in ${entry.glb}`);
            const source = merged.geometry.getAttribute("position");
            const l = await loadTransformedAssetPositions(entry.id, left);
            const r = await loadTransformedAssetPositions(entry.id, right);
            expect(l.positions.length).toBe(source.count * 3);
            let worstSourceError = 0;
            let worstMirrorError = 0;
            for (let i = 0; i < source.count; i++) {
                worstSourceError = Math.max(
                    worstSourceError,
                    Math.abs(l.positions[i * 3]! - source.getY(i) * left.scaleY),
                    Math.abs(l.positions[i * 3 + 1]! + source.getX(i) * left.scaleX),
                    Math.abs(l.positions[i * 3 + 2]! - Math.max(0, source.getZ(i) * left.scaleZ)),
                );
                worstMirrorError = Math.max(
                    worstMirrorError,
                    Math.abs(l.positions[i * 3]! - r.positions[i * 3]!),
                    Math.abs(l.positions[i * 3 + 1]! + r.positions[i * 3 + 1]!),
                    Math.abs(l.positions[i * 3 + 2]! - r.positions[i * 3 + 2]!),
                );
            }
            expect(worstSourceError).toBeLessThan(0.0001);
            expect(worstMirrorError).toBe(0);
            // Reflection must reverse triangle winding so top faces stay visible.
            let wrongWinding = 0;
            for (let i = 0; i < l.indices.length; i += 3) {
                if (
                    r.indices[i] !== l.indices[i] ||
                    r.indices[i + 1] !== l.indices[i + 2] ||
                    r.indices[i + 2] !== l.indices[i + 1]
                )
                    wrongWinding++;
            }
            expect(wrongWinding).toBe(0);
            expect(JSON.stringify(placed)).toBe(saved);
            merged.geometry.dispose();
            group.clear();
        });
    }
});
