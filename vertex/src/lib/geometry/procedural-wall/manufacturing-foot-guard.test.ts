// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { defaultElementPose } from "@/lib/geometry/elements";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { outlineHalfWidth } from "@/lib/geometry/height-field";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import { markingWithComposedText } from "../../../../shared/bottom-text-marking";
import { designSettingsEnvelope } from "../../../../shared/design-settings";
import {
    assertLoftedFootMesh,
    composedFootRim,
    ManufacturingFootRefusal,
    meshOutlineIoU,
    plantarNameEngraved,
    stlPositions,
} from "./manufacturing-foot-guard";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";

const SAMPLE_TOP = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf");

/** Synthetic marking only. No patient string. */
const MARK = "TEST";

function design2e781189(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.usMenSize = 6;
    design.shoeWidth = "narrow";
    design.shoeWidthBySide = { left: "narrow", right: "narrow" };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, heelCupHeightMm: 9 },
        right: { ...design.corrections.right, heelCupHeightMm: 9 },
    };
    const layout = insoleLayoutFromDesign(design);
    const elements: PlacedElement[] = [];
    for (const side of ["left", "right"] as const) {
        const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
        elements.push({
            id: `met-${side}`,
            kind: "met_pad",
            side,
            position: pose.position,
            rotationDeg: pose.rotationDeg,
            scale: pose.scale,
            heightMm: pose.heightMm,
        });
    }
    design.elements = elements;
    design.textMarking = { ...defaultTextMarking("bottom"), text: MARK, addPatientName: false };
    return design;
}

function install(design: DesignState): void {
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

async function prime(): Promise<ArrayBuffer> {
    resetSampleTopGeometryCache();
    const bytes = readFileSync(SAMPLE_TOP);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    primeSampleTopGeometry(await sampleTopFromArrayBuffer(copy));
    const font = readFileSync(FONT);
    primeTextFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
    return copy;
}

function triangleCount(stl: ArrayBuffer): number {
    return new DataView(stl).getUint32(80, true);
}

function footRim(): Array<{ x: number; y: number }> {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        const half = 18 + 22 * Math.sin(Math.PI * u) ** 1.2;
        const x = 20 + u * 220;
        const pinch = u > 0.35 && u < 0.6 ? 8 : 0;
        pts.push({ x, y: -half });
        pts.push({ x, y: half - pinch });
    }
    return pts;
}

function xyz(pts: Array<{ x: number; y: number; z: number }>): number[] {
    const out = [];
    for (const p of pts) out.push(p.x, p.y, p.z);
    return out;
}

describe("manufacturing foot guard", () => {
    const rim = footRim();

    test("refuses a generic last, a flipped foot, a heel-first solid, and a missing name", () => {
        const minX = Math.min(...rim.map((p) => p.x));
        const maxX = Math.max(...rim.map((p) => p.x));
        const span = maxX - minX;
        const last = [];
        for (let i = 0; i <= 24; i++) {
            const u = i / 24;
            const hw = outlineHalfWidth(u) * 40;
            const x = minX + u * span;
            last.push({ x, y: -hw, z: u < 0.2 ? 20 : 3 }, { x, y: hw, z: u < 0.2 ? 20 : 3 });
        }
        expect(() =>
            assertLoftedFootMesh({
                positions: xyz(last),
                side: "left",
                footRim: rim,
                widthMm: 80,
                textRequired: false,
            }),
        ).toThrow(ManufacturingFootRefusal);

        const flipped = rim.map((p) => ({
            x: p.x,
            y: p.y,
            z: p.x < minX + span * 0.2 ? 22 : p.x > minX + span * 0.8 ? 3 : p.y > 0 ? 18 : 8,
        }));
        expect(() =>
            assertLoftedFootMesh({
                positions: xyz(flipped),
                side: "left",
                footRim: rim,
                widthMm: 80,
                textRequired: false,
            }),
        ).toThrow(/handedness margin/);

        const heelFirst = rim.map((p) => ({
            x: p.x,
            y: p.y,
            z: p.x > minX + span * 0.8 ? 22 : 3,
        }));
        expect(() =>
            assertLoftedFootMesh({
                positions: xyz(heelFirst),
                side: "left",
                footRim: rim,
                widthMm: 80,
                textRequired: false,
            }),
        ).toThrow(/heel-first/);

        const unnamed = rim.map((p) => ({
            x: p.x,
            y: p.y,
            z:
                p.x < minX + span * 0.2
                    ? 22
                    : p.y < 0 && p.x > minX + span * 0.4 && p.x < minX + span * 0.6
                      ? 16
                      : 4,
        }));
        expect(() =>
            assertLoftedFootMesh({
                positions: xyz(unnamed),
                side: "left",
                footRim: rim,
                widthMm: 80,
                textRequired: true,
            }),
        ).toThrow(/plantar name/);
    });
});

describe("design 2e781189 headless export", () => {
    test("both feet match the UI foot outline, handedness, toe-first, and plantar name", async () => {
        const sampleTop = await prime();
        const design = design2e781189();
        const envelope = designSettingsEnvelope(design as unknown as Record<string, unknown>);
        const elementsBaseDir = resolve(process.cwd(), "vertex/public/elements");
        for (const side of ["left", "right"] as const satisfies readonly Side[]) {
            install(design);
            const ui = await buildExportStl(side, { exportMode: "manufacturing", beltPrint: true });
            const head = await buildFinalizedFootFromSavedSettings({
                settingsJson: envelope,
                side,
                sampleTopBytes: sampleTop,
                includeLeader: true,
                fontBytes: (() => {
                    const font = readFileSync(FONT);
                    return font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
                })(),
                elementsBaseDir,
            });
            const uiPos = stlPositions(ui);
            const headPos = stlPositions(head.stl);
            const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
            const foot = await composedFootRim(fresh, design, side);
            fresh.dispose();
            const uiIou = meshOutlineIoU(uiPos, foot);
            const headIou = meshOutlineIoU(headPos, foot);
            const cross = meshOutlineIoU(headPos, outlineFrom(uiPos));
            // The wall and the leader sit inside the top rim, so rim overlap is
            // just under 1. The two exports are the comparison that must clear 0.98.
            expect(uiIou, `${side} UI vs SAMPLE_Top`).toBeGreaterThanOrEqual(0.97);
            expect(headIou, `${side} headless vs SAMPLE_Top`).toBeGreaterThanOrEqual(0.97);
            expect(cross, `${side} headless vs UI`).toBeGreaterThanOrEqual(0.98);
            const uiTris = triangleCount(ui);
            expect(Math.abs(head.solidTriangles - uiTris) / uiTris, `${side} triangle class`).toBeLessThan(
                0.02,
            );
            expect(plantarNameEngraved(headPos, foot), `${side} plantar name`).toBe(true);
            expect(plantarNameEngraved(uiPos, foot), `${side} UI plantar name`).toBe(true);
            expect(createHash("sha256").update(Buffer.from(head.stl)).digest("hex")).toMatch(
                /^[a-f0-9]{64}$/,
            );
        }
    }, 600_000);
});

/**
 * Production generate composes the patient line into textMarking per side
 * (envelopeWithLoftTextMarking), then lofts. Short narrow right feet take the
 * post-loft mirror. Both sizes must engrave. The left foot is the UI solid.
 */
describe("production right-foot plantar name", () => {
    test("short narrow right feet engrave the composed name and the left foot matches UI", async () => {
        const sampleTop = await prime();
        const font = readFileSync(FONT);
        const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
        const elementsBaseDir = resolve(process.cwd(), "vertex/public/elements");
        for (const usMenSize of [6, 8] as const) {
            const design = design2e781189();
            design.usMenSize = usMenSize;
            const layout = insoleLayoutFromDesign(design);
            design.elements = (["left", "right"] as const).map((side) => {
                const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
                return {
                    id: `met-${side}`,
                    kind: "met_pad" as const,
                    side,
                    position: pose.position,
                    rotationDeg: pose.rotationDeg,
                    scale: pose.scale,
                    heightMm: pose.heightMm,
                };
            });
            const hashes: Partial<Record<Side, string>> = {};
            for (const side of ["left", "right"] as const) {
                const composed = markingWithComposedText(
                    { ...defaultTextMarking("bottom"), text: "", addPatientName: true, feet: "both" },
                    side,
                    MARK,
                );
                expect(composed.text, `${usMenSize} ${side} composed`).toBe(MARK);
                const saved = { ...design, textMarking: composed };
                install(saved);
                const ui = await buildExportStl(side, { exportMode: "manufacturing", beltPrint: true });
                const head = await buildFinalizedFootFromSavedSettings({
                    settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                    side,
                    sampleTopBytes: sampleTop,
                    includeLeader: true,
                    fontBytes,
                    elementsBaseDir,
                });
                const uiPos = stlPositions(ui);
                const headPos = stlPositions(head.stl);
                const uiTris = triangleCount(ui);
                // The production STL adds the leader and the foot stamp. The solid
                // underneath is the UI export: same triangle class, same outline.
                expect(
                    Math.abs(head.solidTriangles - uiTris) / uiTris,
                    `US M${usMenSize} ${side} triangle class`,
                ).toBeLessThan(0.02);
                expect(
                    meshOutlineIoU(headPos, outlineFrom(uiPos)),
                    `US M${usMenSize} ${side} vs UI`,
                ).toBeGreaterThanOrEqual(0.98);
                const headHash = createHash("sha256").update(Buffer.from(head.stl)).digest("hex");
                const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
                const foot = await composedFootRim(fresh, saved, side);
                fresh.dispose();
                expect(plantarNameEngraved(headPos, foot), `US M${usMenSize} ${side} name`).toBe(true);
                expect(plantarNameEngraved(uiPos, foot), `US M${usMenSize} ${side} UI name`).toBe(true);
                hashes[side] = headHash;
            }
            expect(hashes.left, `US M${usMenSize} feet differ`).not.toBe(hashes.right);
        }
    }, 600_000);
});

function outlineFrom(positions: Float64Array): Array<{ x: number; y: number }> {
    const pts = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
        pts.push({ x: positions[i] ?? 0, y: positions[i + 1] ?? 0 });
    }
    return pts;
}
