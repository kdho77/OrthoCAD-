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

/** Synthetic marking only. No patient string. Counters (A, B, O, R) stay open. */
const MARK = "JABBOUR";

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
            const uiMid = narrowestMidfoot(uiPos);
            const headMid = narrowestMidfoot(headPos);
            // This US M6 narrow foot's midfoot is the composed outline (~61 mm),
            // not the waisted parametric last (~44 mm). Headless matches UI.
            expect(Math.abs(uiMid - headMid), `${side} midfoot UI vs headless`).toBeLessThan(1.5);
            expect(uiMid, `${side} UI midfoot`).toBeGreaterThan(58);
            expect(headMid, `${side} headless midfoot`).toBeGreaterThan(58);
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
 * (envelopeWithLoftTextMarking), then lofts. US M6 is design 2e781189. US M8
 * is the same short-narrow right foot, which takes the post-loft mirror.
 * Both must engrave. The left foot stays the UI solid.
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

/**
 * Design ffcfa6f9. US men 6.5, medium, corrections 0, no elements, thickness 2,
 * printing_solid, apex-belt Hard. KANDIS MAAR is the two-word line that left
 * the letter floor open. MANDIS KAAR is the same letters in the other order.
 * Counters are A, D, and R. The headless belt export runs assertExactManifold
 * and refuses the upload when that check throws.
 */
const MAAR_NAMES = ["MANDIS KAAR", "KANDIS MAAR"] as const;

function designFfcfa6f9(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.pattern = "full_contact";
    design.thicknessMm = 2;
    design.sizeSystem = "us";
    design.usMenSize = 6.5;
    design.shoeWidth = "medium";
    design.shoeWidthBySide = { left: "medium", right: "medium" };
    design.elements = [];
    design.shellThicknessMode = "zonal";
    design.shellThicknessFfMm = 2;
    design.shellThicknessMfMm = 2.5;
    design.shellThicknessRfMm = 3;
    design.shellThicknessBlendMm = 12;
    design.corrections = {
        ...design.corrections,
        linked: true,
        unit: "mm",
        left: { ...design.corrections.left, archElongationMm: 0 },
        right: { ...design.corrections.right, archElongationMm: 0 },
    };
    if (design.paired) {
        design.paired = {
            ...design.paired,
            linked: false,
            leftThicknessMm: 2,
            rightThicknessMm: 2,
            leftMethod: "printing_solid",
            rightMethod: "printing_solid",
        };
    }
    if (design.printRecipe) {
        design.printRecipe = { ...design.printRecipe, defaultHardness: "Hard", profileId: "apex-belt-v2" };
    }
    if (design.shapeFinish) {
        design.shapeFinish = { ...design.shapeFinish, linked: true };
    }
    return design;
}

/**
 * Small closed loops in the z=0.6 floor are the open counters (A, D, R).
 * A filled counter has no inner loop.
 */
function engraveCounterLoops(positions: Float64Array): number {
    const zOf = (i: number) => positions[i * 3 + 2] ?? 0;
    const xy = (i: number) => `${(positions[i * 3] ?? 0).toFixed(3)},${(positions[i * 3 + 1] ?? 0).toFixed(3)}`;
    const next = new Map<string, string[]>();
    const nTri = positions.length / 9;
    const edgeCount = new Map<string, number>();
    const undirected = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t < nTri; t++) {
        const ids = [t * 3, t * 3 + 1, t * 3 + 2];
        if (ids.some((i) => zOf(i) < 0.55 || zOf(i) > 0.65)) continue;
        const keys = ids.map(xy);
        for (let e = 0; e < 3; e++) {
            const k = undirected(keys[e]!, keys[(e + 1) % 3]!);
            edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
        }
    }
    for (const [k, n] of edgeCount) {
        if (n !== 1) continue;
        const [a, b] = k.split("|");
        if (!a || !b) continue;
        const list = next.get(a) ?? [];
        list.push(b);
        next.set(a, list);
        const back = next.get(b) ?? [];
        back.push(a);
        next.set(b, back);
    }
    const used = new Set<string>();
    let counters = 0;
    for (const start of next.keys()) {
        if (used.has(start)) continue;
        const loop = [start];
        used.add(start);
        let prev = "";
        let cur = start;
        let guard = 0;
        while (guard++ < next.size + 2) {
            const opts = (next.get(cur) ?? []).filter((v) => v !== prev && !used.has(v));
            if (!opts.length) break;
            const nxt = opts[0]!;
            if (nxt === start) break;
            used.add(nxt);
            loop.push(nxt);
            prev = cur;
            cur = nxt;
        }
        if (loop.length < 6) continue;
        let area = 0;
        for (let i = 0; i < loop.length; i++) {
            const [ax, ay] = loop[i]!.split(",").map(Number);
            const [bx, by] = loop[(i + 1) % loop.length]!.split(",").map(Number);
            area += (ax ?? 0) * (by ?? 0) - (bx ?? 0) * (ay ?? 0);
        }
        const abs = Math.abs(area) * 0.5;
        if (abs >= 0.4 && abs <= 30) counters++;
    }
    return counters;
}

describe("design ffcfa6f9 plantar name", () => {
    test("US M6.5 medium engraves MANDIS KAAR and KANDIS MAAR on both feet", async () => {
        const sampleTop = await prime();
        const font = readFileSync(FONT);
        const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
        const elementsBaseDir = resolve(process.cwd(), "vertex/public/elements");
        for (const name of MAAR_NAMES) {
            for (const side of ["left", "right"] as const) {
                const design = designFfcfa6f9();
                const composed = markingWithComposedText(
                    {
                        ...defaultTextMarking("bottom"),
                        text: "",
                        addPatientName: true,
                        feet: "both",
                        capHeightUserSet: false,
                    },
                    side,
                    name,
                );
                expect(composed.text).toBe(name);
                const saved = { ...design, textMarking: composed };
                install(saved);
                const head = await buildFinalizedFootFromSavedSettings({
                    settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                    side,
                    sampleTopBytes: sampleTop,
                    includeLeader: true,
                    fontBytes,
                    elementsBaseDir,
                });
                const headPos = stlPositions(head.stl);
                const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
                const foot = await composedFootRim(fresh, saved, side);
                fresh.dispose();
                expect(plantarNameEngraved(headPos, foot), `${side} ${name}`).toBe(true);
                // Three A's, one D, one R. A filled counter has no inner loop.
                expect(engraveCounterLoops(headPos), `${side} ${name} counters`).toBeGreaterThanOrEqual(5);
            }
        }
    }, 600_000);
});

function narrowestMidfoot(positions: Float64Array): number {
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i + 1 < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    }
    const span = Math.max(1e-6, maxX - minX);
    const bins = 48;
    const lo = new Array<number>(bins).fill(Infinity);
    const hi = new Array<number>(bins).fill(-Infinity);
    for (let i = 0; i + 1 < positions.length; i += 3) {
        const x = positions[i] ?? 0;
        const y = positions[i + 1] ?? 0;
        const u = (x - minX) / span;
        if (u < 0.35 || u > 0.65) continue;
        let b = Math.floor(((u - 0.35) / 0.3) * (bins - 1));
        if (b < 0) b = 0;
        if (b >= bins) b = bins - 1;
        if (y < lo[b]!) lo[b] = y;
        if (y > hi[b]!) hi[b] = y;
    }
    let best = Infinity;
    for (let i = 0; i < bins; i++) {
        if (!Number.isFinite(lo[i])) continue;
        best = Math.min(best, hi[i]! - lo[i]!);
    }
    return best;
}

function outlineFrom(positions: Float64Array): Array<{ x: number; y: number }> {
    const pts = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
        pts.push({ x: positions[i] ?? 0, y: positions[i + 1] ?? 0 });
    }
    return pts;
}
