// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";

const baseInsoleMeshSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "BaseInsoleMesh.tsx"),
    "utf8",
);

const elementSurfaceSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "ElementSurfaceMeshes.tsx"),
    "utf8",
);

describe("BaseInsoleMesh heightmap element overlays", () => {
    test("renders ElementSurfaceMeshes regardless of heightmap", () => {
        expect(baseInsoleMeshSource).toMatch(/<ElementSurfaceMeshes/);
        expect(baseInsoleMeshSource).not.toMatch(/\{!heightmap &&[\s\S]*<ElementSurfaceMeshes/);
    });

    test("passes heightmap prop into ElementSurfaceMeshes", () => {
        expect(baseInsoleMeshSource).toMatch(/heightmap=\{heightmap\}/);
    });

    test("shares applyHeightmapColors helper with element surfaces", () => {
        expect(baseInsoleMeshSource).toContain('from "./heightmap-colors"');
        expect(elementSurfaceSource).toContain('from "./heightmap-colors"');
        expect(elementSurfaceSource).toMatch(/vertexColors=\{useHeightmapSurface\}/);
        expect(elementSurfaceSource).toMatch(/applyHeightmapColors\(surface, colors, heightmapZRange\)/);
    });

    test("keeps base edge extract gated off heightmap", () => {
        expect(baseInsoleMeshSource).toMatch(/const showEdges\s*=\s*\n\s*!heightmap &&/);
    });
});
