// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildExportGeometry } from "@/lib/geometry/export-geometry";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import type { BottomOutlineWorld } from "@/lib/geometry/text-marking/bottom-engrave";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";
import { encodePng, type RenderView, renderMesh } from "./helpers/render-png";

const SAMPLE_TOP_FIXTURE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const DIAG_DIR = resolve(process.cwd(), "docs/diagnostics/bottom-text-1114");

/** Plantar face viewed from below (−Z): toe along +X on screen; lateral is −world Y. */
const BOTTOM_VIEW: RenderView = {
    right: [1, 0, 0],
    up: [0, -1, 0],
    light: [0.15, 0.25, -0.95],
};

function viewFromBelow(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x, y: -p.y };
}

function glyphCentroid(outline: BottomOutlineWorld): { x: number; y: number; z: number } {
    const pts = outline.outer;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
        z += p.z;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n, z: z / n };
}

function textCentroids(geo: BufferGeometry): Array<{ x: number; y: number; z: number }> {
    return (
        (geo.userData as { textMarking?: { centroids?: Array<{ x: number; y: number; z: number }> } })
            .textMarking?.centroids ?? []
    );
}

/** Asymmetric bias of the first glyph (J hook) in the below-view frame. */
function jHookBias(outline: BottomOutlineWorld): number {
    const pts = outline.outer;
    if (!pts.length) return 0;
    const c = glyphCentroid(outline);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of pts) {
        const v = viewFromBelow({ x: p.x - c.x, y: p.y - c.y });
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
    }
    return maxX + minX;
}

function bootDesignExportHarness(): void {
    resetSampleTopGeometryCache();
    const buf = readFileSync(SAMPLE_TOP_FIXTURE);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("SAMPLE_Top")) {
            return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
        }
        throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    useClientStore.setState({
        activeClientId: "bottomtext-client",
        clients: [
            {
                id: "bottomtext-client",
                firstName: "JOHN",
                lastName: "SMITH",
                displayName: "",
                reference: "JS-1",
                dateOfBirth: null,
                notes: "",
                shoeChart: {
                    shoeSizeUs: 9,
                    shoeSizesSplit: false,
                    shoeSizeLeftUs: 9,
                    shoeSizeRightUs: 9,
                    shoeWidth: "medium",
                },
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                archivedAt: null,
            },
        ],
    });

    const design = createDesignWithStockPlaceholder();
    design.usMenSize = 9;
    design.textMarking = {
        ...defaultTextMarking("bottom"),
        addPatientName: true,
        text: "",
        feet: "both",
    };
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({
        design,
        viewer: { ...viewer, wallModel: "procedural", wallStyle: "straight" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

function bottomOutlines(geo: BufferGeometry): BottomOutlineWorld[] {
    return (geo.userData as { bottomOutlineWorld?: BottomOutlineWorld[] }).bottomOutlineWorld ?? [];
}

function writeBottomPng(geo: BufferGeometry, side: Side): void {
    mkdirSync(DIAG_DIR, { recursive: true });
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()?.array ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const outlines = bottomOutlines(geo);
    const cents = outlines.map(glyphCentroid);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const c of cents) {
        cx += c.x;
        cy += c.y;
        cz += c.z;
    }
    const n = Math.max(1, cents.length);
    const focus = {
        center: { x: cx / n, y: cy / n, z: cz / n },
        radius: 55,
    };
    const rgb = renderMesh(pos, idx, BOTTOM_VIEW, 900, 680, [160, 168, 184], 32, focus);
    writeFileSync(resolve(DIAG_DIR, `${side}-john-smith-from-below.png`), encodePng(900, 680, rgb));
}

describe("bottom patient-name text reads from below (export mesh)", () => {
    beforeEach(() => bootDesignExportHarness());
    afterEach(() => resetSampleTopGeometryCache());

    test("JOHN SMITH export mesh: matched handedness on left and right", async () => {
        const readSign: Partial<Record<Side, number>> = {};
        const hookSign: Partial<Record<Side, number>> = {};

        for (const side of ["left", "right"] as const) {
            const geo = await buildExportGeometry(side);
            try {
                const ud = geo.userData as { textFitError?: string };
                expect(ud.textFitError ?? "").toBe("");
                const outlines = bottomOutlines(geo);
                const cents = textCentroids(geo);
                expect(cents.length).toBeGreaterThanOrEqual(9);
                expect(outlines.length).toBeGreaterThan(0);
                const read = Math.sign((cents[cents.length - 1]?.x ?? 0) - (cents[0]?.x ?? 0));
                expect(read).not.toBe(0);
                readSign[side] = read;

                const hook = jHookBias(outlines[0]!);
                expect(Math.sign(hook)).not.toBe(0);
                hookSign[side] = Math.sign(hook);

                writeBottomPng(geo, side);
            } finally {
                geo.dispose();
            }
        }

        expect(readSign.left).toBe(readSign.right);
        expect(hookSign.left).toBe(hookSign.right);
    }, 360_000);
});
