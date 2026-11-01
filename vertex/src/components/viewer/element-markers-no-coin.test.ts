// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";

function repoFile(...parts: string[]): string {
    const a = resolve(process.cwd(), ...parts);
    const b = resolve(process.cwd(), "vertex", ...parts);
    if (existsSync(a)) return a;
    if (existsSync(b)) return b;
    return a;
}

const MARKERS = repoFile("src/components/viewer/ElementMarkers.tsx");
const PANEL = repoFile("src/components/layout/RightPanel.tsx");

describe("element overlay has no deposited coin", () => {
    test("ElementMarkers draws no cylinder / instanced disc", () => {
        const src = readFileSync(MARKERS, "utf8");
        expect(src).not.toMatch(/cylinderGeometry/i);
        expect(src).not.toMatch(/CylinderGeometry/);
        expect(src).not.toMatch(/instancedMesh/i);
        expect(src).toMatch(/TransformControls/);
    });

    test("Elements panel has no stale coming-soon note", () => {
        const src = readFileSync(PANEL, "utf8");
        expect(src).not.toMatch(/coming soon/i);
        expect(src).toMatch(/ElementsPanel/);
    });
});
