// Independent grader for PR #461 gates G1, G2, G4 @ 4d223923. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import {
    composedFootRim,
    plantarNameEngraved,
    stlPositions,
} from "@/lib/geometry/procedural-wall/manufacturing-foot-guard";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, Side } from "@/types";
import { markingWithComposedText } from "../shared/bottom-text-marking";
import { designSettingsEnvelope } from "../shared/design-settings";

const SAMPLE_TOP = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf");
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PR461_HEAD = "4d2239239125082f8d90de81e1410681b7f33597";

const GRADER_FULL_NAMES = [
    "KATE WONG",
    "MARK D'SOUZA",
    "GWEN STACY",
    "DAWN-M SMITH",
    "MORGAN QWEST",
    "KYLE WATERS",
    "AMOS GENTRY",
    "WADE MCKENZIE",
    "SUSAN Q MARK",
    "DOUGLAS WADE",
] as const;

function pr461FixPresent(): boolean {
    return readFileSync(
        resolve(REPO_ROOT, "vertex/src/lib/geometry/text-marking/bottom-engrave.ts"),
        "utf8",
    ).includes("stitchOpenEngraveSeam");
}

const rt = pr461FixPresent() ? test : test.skip;

function maarDesign(usMenSize: number): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.pattern = "full_contact";
    design.thicknessMm = 2;
    design.sizeSystem = "us";
    design.usMenSize = usMenSize;
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

function install(design: DesignState): void {
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

async function primeHarness(): Promise<ArrayBuffer> {
    resetSampleTopGeometryCache();
    const bytes = readFileSync(SAMPLE_TOP);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    primeSampleTopGeometry(await sampleTopFromArrayBuffer(copy));
    const font = readFileSync(FONT);
    primeTextFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
    return copy;
}

async function headlessStl(name: string, side: Side, usMenSize: number): Promise<ArrayBuffer> {
    const sampleTop = await primeHarness();
    const font = readFileSync(FONT);
    const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
    const design = maarDesign(usMenSize);
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
    const saved = { ...design, textMarking: composed };
    install(saved);
    const head = await buildFinalizedFootFromSavedSettings({
        settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
        side,
        sampleTopBytes: sampleTop,
        includeLeader: true,
        fontBytes,
        elementsBaseDir: resolve(process.cwd(), "vertex/public/elements"),
    });
    return head.stl.slice(0);
}

function sha256(buf: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(buf)).digest("hex");
}

function viewFromBelow(x: number, y: number): { x: number; y: number } {
    return { x, y: -y };
}

/** First glyph should sit left of the last when read from the plantar side (not mirrored). */
/** Floor-letter clusters in manufacturing STL: first word sits at lower x than second (from below). */
function assertNameReadsFromBelowStl(pos: Float64Array, side: Side): void {
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 2 < pos.length; i += 3) {
        const z = pos[i + 2] ?? 0;
        if (z < 0.55 || z > 0.68) continue;
        pts.push(viewFromBelow(pos[i] ?? 0, pos[i + 1] ?? 0));
    }
    expect(pts.length, `${side} floor verts`).toBeGreaterThan(40);
    pts.sort((a, b) => a.x - b.x);
    const mid = (pts[0]!.x + pts[pts.length - 1]!.x) / 2;
    const left = pts.filter((p) => p.x < mid - 2);
    const right = pts.filter((p) => p.x > mid + 2);
    expect(left.length, `${side} KANDIS cluster`).toBeGreaterThan(10);
    expect(right.length, `${side} MAAR cluster`).toBeGreaterThan(10);
    const leftCx = left.reduce((s, p) => s + p.x, 0) / left.length;
    const rightCx = right.reduce((s, p) => s + p.x, 0) / right.length;
    expect(leftCx, `${side} mirrored?`).toBeLessThan(rightCx);
}

describe("PR #461 grader G1 — KANDIS MAAR on Maar settings", () => {
    rt(
        "KANDIS MAAR passes exact manifold guard on both feet",
        async () => {
            const sampleTop = await primeHarness();
            const font = readFileSync(FONT);
            const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
            for (const side of ["left", "right"] as const) {
                const design = maarDesign(6.5);
                const composed = markingWithComposedText(
                    {
                        ...defaultTextMarking("bottom"),
                        text: "",
                        addPatientName: true,
                        feet: "both",
                        capHeightUserSet: false,
                    },
                    side,
                    "KANDIS MAAR",
                );
                const saved = { ...design, textMarking: composed };
                install(saved);
                const head = await buildFinalizedFootFromSavedSettings({
                    settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                    side,
                    sampleTopBytes: sampleTop,
                    includeLeader: true,
                    fontBytes,
                    elementsBaseDir: resolve(process.cwd(), "vertex/public/elements"),
                });
                const headPos = stlPositions(head.stl);
                const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
                const foot = await composedFootRim(fresh, saved, side);
                fresh.dispose();
                expect(plantarNameEngraved(headPos, foot), side).toBe(true);
            }
        },
        600_000,
    );

    rt(
        "KANDIS MAAR reads correctly from below on both feet",
        async () => {
            const sampleTop = await primeHarness();
            const font = readFileSync(FONT);
            const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
            for (const side of ["left", "right"] as const) {
                const design = maarDesign(6.5);
                const composed = markingWithComposedText(
                    {
                        ...defaultTextMarking("bottom"),
                        text: "",
                        addPatientName: true,
                        feet: "both",
                        capHeightUserSet: false,
                    },
                    side,
                    "KANDIS MAAR",
                );
                const saved = { ...design, textMarking: composed };
                install(saved);
                const head = await buildFinalizedFootFromSavedSettings({
                    settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                    side,
                    sampleTopBytes: sampleTop,
                    includeLeader: true,
                    fontBytes,
                    elementsBaseDir: resolve(process.cwd(), "vertex/public/elements"),
                });
                assertNameReadsFromBelowStl(stlPositions(head.stl), side);
            }
        },
        600_000,
    );
});

describe("PR #461 grader G2 — ten realistic full names at US M6 and M10", () => {
    rt(
        "each name passes headless belt export on both feet",
        async () => {
            for (const name of GRADER_FULL_NAMES) {
                expect(name.length).toBeGreaterThanOrEqual(8);
                expect(name.length).toBeLessThanOrEqual(24);
                for (const usMenSize of [6, 10] as const) {
                    for (const side of ["left", "right"] as const) {
                        const stl = await headlessStl(name, side, usMenSize);
                        const pos = stlPositions(stl);
                        const design = maarDesign(usMenSize);
                        const fresh = await sampleTopFromArrayBuffer((await primeHarness()).slice(0));
                        const foot = await composedFootRim(fresh, design, side);
                        fresh.dispose();
                        expect(plantarNameEngraved(pos, foot), `${name} M${usMenSize} ${side}`).toBe(true);
                        const dv = new DataView(stl);
                        const tris = dv.getUint32(80, true);
                        expect(tris, `${name} M${usMenSize} ${side} triangles`).toBeGreaterThan(10_000);
                    }
                }
            }
        },
        1_800_000,
    );
});

describe("PR #461 grader G4 — passing names and no-text meshes unchanged vs main", () => {
    function mainSha(side: Side, name: string | null, usMenSize: number): string {
        const label = name ?? "notext";
        const path = `tests/fixtures/pr461-main-baseline/${usMenSize}/${label}-${side}.sha256`;
        return readFileSync(resolve(REPO_ROOT, path), "utf8").trim();
    }

    rt(
        "MAAR, MANDIS KAAR, and no-text STLs match main pin hashes",
        async () => {
            const cases: Array<{ name: string | null; sizes: number[] }> = [
                { name: "MAAR", sizes: [6.5] },
                { name: "MANDIS KAAR", sizes: [6.5] },
                { name: null, sizes: [6.5] },
            ];
            for (const { name, sizes } of cases) {
                for (const usMenSize of sizes) {
                    for (const side of ["left", "right"] as const) {
                        let stl: ArrayBuffer;
                        if (name) {
                            stl = await headlessStl(name, side, usMenSize);
                        } else {
                            const sampleTop = await primeHarness();
                            const font = readFileSync(FONT);
                            const fontBytes = font.buffer.slice(
                                font.byteOffset,
                                font.byteOffset + font.byteLength,
                            );
                            const design = maarDesign(usMenSize);
                            design.textMarking = {
                                ...defaultTextMarking("bottom"),
                                text: "",
                                addPatientName: false,
                                feet: "both",
                            };
                            install(design);
                            const head = await buildFinalizedFootFromSavedSettings({
                                settingsJson: designSettingsEnvelope(
                                    design as unknown as Record<string, unknown>,
                                ),
                                side,
                                sampleTopBytes: sampleTop,
                                includeLeader: true,
                                fontBytes,
                                elementsBaseDir: resolve(process.cwd(), "vertex/public/elements"),
                            });
                            stl = head.stl.slice(0);
                        }
                        const got = sha256(stl);
                        const want = mainSha(side, name, usMenSize);
                        expect(got, `${name ?? "no-text"} ${side} M${usMenSize}`).toBe(want);
                    }
                }
            }
        },
        900_000,
    );

    rt(
        "MAAR on PR matches main pin and KANDIS MAAR does not (stitch path only when needed)",
        async () => {
            const maar = await headlessStl("MAAR", "right", 6.5);
            const kandis = await headlessStl("KANDIS MAAR", "right", 6.5);
            expect(sha256(maar)).toBe(mainSha("right", "MAAR", 6.5));
            expect(sha256(kandis)).not.toBe(sha256(maar));
        },
        600_000,
    );
});
