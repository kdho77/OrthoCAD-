// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";
import { applyTextMarkingToPrintSolid } from "./apply";
import { assertExactManifold } from "./boolean";
import { defaultTextMarking } from "./constants";
import { TextMarkingError } from "./errors";

const ZERO: SideCorrections = {
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

async function loftFoot(side: Side) {
    const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    const preview = await reconstructProceduralPreview(raw, {
        corrections: { ...ZERO },
        wallStyle: "straight",
        scanPattern: "full_contact",
        side,
        thicknessMm: 2,
    });
    raw.dispose();
    return preview.geometry;
}

function signedVolume(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos || !index) return 0;
    let v = 0;
    for (let t = 0; t + 2 < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        const ax = pos.getX(a);
        const ay = pos.getY(a);
        const az = pos.getZ(a);
        const bx = pos.getX(b);
        const by = pos.getY(b);
        const bz = pos.getZ(b);
        const cx = pos.getX(c);
        const cy = pos.getY(c);
        const cz = pos.getZ(c);
        v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
}

/** Edges that are not shared by exactly two triangles. */
function openEdgeCount(geo: BufferGeometry): number {
    const index = geo.getIndex();
    if (!index) return -1;
    const edge = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t + 2 < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = key(u, v);
            edge.set(k, (edge.get(k) ?? 0) + 1);
        }
    }
    let open = 0;
    for (const n of edge.values()) if (n !== 2) open++;
    return open;
}

describe("bottom patient-name engrave on SAMPLE_Top", () => {
    test("TIMOTHY HARTER and GARY PURKEY stay closed at 6 mm bold", async () => {
        for (const side of ["left", "right"] as const) {
            const host = await loftFoot(side);
            const hostVol = Math.abs(signedVolume(host));
            for (const name of ["TIMOTHY HARTER", "GARY PURKEY"]) {
                const marking = {
                    ...defaultTextMarking("bottom"),
                    text: "",
                    addPatientName: true,
                    bold: true,
                    capHeightMm: 6,
                    depthMm: 0.6,
                    anchor: "arch" as const,
                };
                const out = await applyTextMarkingToPrintSolid(host, marking, { side }, name);
                await assertExactManifold(out);
                expect(openEdgeCount(out)).toBe(0);
                expect(hostVol - Math.abs(signedVolume(out))).toBeGreaterThan(0);
                const outlines = (out.userData as { bottomOutlineWorld?: unknown[] }).bottomOutlineWorld;
                expect(outlines?.length ?? 0).toBeGreaterThan(0);
                out.dispose();
            }
            host.dispose();
        }
    }, 180_000);
});

describe("assertExactManifold", () => {
    test("a library Not manifold becomes TextMarkingError stl-gate", async () => {
        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
        geo.setIndex([0, 1, 2]);
        let caught: unknown;
        try {
            await assertExactManifold(geo);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(TextMarkingError);
        expect((caught as TextMarkingError).code).toBe("stl-gate");
        expect((caught as Error).message).toContain("Not manifold");
        geo.dispose();
    });
});
