// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useDesignStore } from "@/stores/design-store";
import { extractTopOnlyModel } from "./extract";
import { assertInsideRim } from "./pattern-hygiene";
import { composeViewerPrintSolidTop } from "./print-solid-compose";
import { printSolidOptions } from "./print-solid-options";
import { buildProceduralViewerPattern, sampleTopFromArrayBuffer } from "./sample-top-preview";

describe("manufacturing composed-top parity", () => {
    for (const side of ["left", "right"] as const) {
        test(`${side}: a wide live bottom pattern must be lofted against the same widened sheet`, async () => {
            const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
            const loaded = await sampleTopFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            );
            const raw = side === "left" ? mirrorGeometry(loaded) : loaded.clone();
            loaded.dispose();
            const design = { ...useDesignStore.getState().design, shoeWidth: "extra_wide" as const };
            const field = baseModifierFieldAuthoritative(design, side, 3);
            const options = printSolidOptions({
                design,
                side,
                field,
                viewer: {},
                trimline: null,
                bottomPattern: null,
            });
            const composed = await composeViewerPrintSolidTop({
                raw,
                sourceField: field,
                shoeWidth: options.shoeWidth,
            });
            const pattern = buildProceduralViewerPattern(composed, design.pattern);
            const rim = (geometry: typeof raw) => {
                const model = extractTopOnlyModel(geometry, { id: "test", name: "test" });
                const pos = model.top.meshPositions;
                const indices = model.top.rimLocal;
                if (!pos || !indices) throw new Error("Fixture top rim missing");
                return indices.map((i) => ({ x: pos[i * 3] ?? 0, y: pos[i * 3 + 1] ?? 0, z: 0 }));
            };
            // Exercise the exact containment gate that rejected the old export.
            expect(() => assertInsideRim(pattern, rim(raw), 0)).toThrow("outside the TopSheet rim");
            expect(() => assertInsideRim(pattern, rim(composed), 0)).not.toThrow();
            composed.dispose();
            raw.dispose();
        }, 240_000);
    }
});
