// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseInsoleMeshSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "BaseInsoleMesh.tsx"),
    "utf8",
);

describe("BaseInsoleMesh heightmap element overlays", () => {
    test("renders ElementSurfaceMeshes regardless of heightmap", () => {
        expect(baseInsoleMeshSource).toMatch(/<ElementSurfaceMeshes/);
        expect(baseInsoleMeshSource).not.toMatch(/\{!heightmap &&[\s\S]*<ElementSurfaceMeshes/);
    });

    test("keeps base edge extract gated off heightmap", () => {
        expect(baseInsoleMeshSource).toMatch(/const showEdges\s*=\s*\n\s*!heightmap &&/);
    });
});