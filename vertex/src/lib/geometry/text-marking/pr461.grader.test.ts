// Independent grader for PR #461 @ 62aadfee66bab1cbeac9c8dd88bb8eadafa63488. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execSync } from "node:child_process";
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
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont, primeTextFont } from "@/lib/geometry/text-marking/font";
import { extractHostTextContext, placeBottomText } from "@/lib/geometry/text-marking/place";
import type { TextXy } from "@/lib/geometry/text-marking/types";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, Side } from "@/types";
import { markingWithComposedText, normalizeBottomTextMarking } from "../../../../shared/bottom-text-marking";
import { designSettingsEnvelope } from "../../../../shared/design-settings";

const SAMPLE_TOP = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf");
const REPO_ROOT = resolve(process.cwd());

/** Mesh repair from PR #461 `62aadfee` — heavy gates skip on `main`. */
const HAS_PR461_REPAIR = readFileSync(
    resolve(REPO_ROOT, "vertex/src/lib/geometry/text-marking/bottom-engrave.ts"),
    "utf8",
).includes("dropDisconnectedSolePatches");
const heavy = HAS_PR461_REPAIR ? describe : describe.skip;

/** Names from plantar-name-sweep.test.ts on PR #461 — grader list must not copy them (except KATE WONG). */
const WORKER_SWEEP_NAMES = new Set([
    "MARK D'SOUZA",
    "GWEN STACY",
    "DAWN-M SMITH",
    "MORGAN QWEST",
    "KYLE WATERS",
    "AMOS GENTRY",
    "WADE MCKENZIE",
    "SUSAN Q MARK",
    "DOUGLAS WADE",
    "BJORN FALK",
    "IVY PAX",
    "FELIX BROOK",
    "PAIGE VOLK",
    "JULES XAVIER",
    "BETH FORD",
    "PHOEBE QUINN",
    "VANCE JOY",
    "BRAD FOX",
    "QUINN BLAKE",
    "YVES JACOB",
    "THEO ZIMMER",
]);

/**
 * KATE WONG (prior grader failure) plus fifteen other names not in the worker's
 * plantar-name-sweep list. Mix of 2–3 words, 8–24 characters.
 */
const GRADER_NAMES = [
    "KATE WONG",
    "DIANA KQMW",
    "ROGER ST-G",
    "LISA O'DELL",
    "HENRY BLIMP",
    "CLARK GABLE",
    "NAOMI WRIGHT",
    "DWIGHT SCHRUTE",
    "GREGORY HOUSE",
    "QUEEN LATIFAH",
    "SHELDON COOPER",
    "JACK DANIELS",
    "MARIE CURIE",
    "WALTER WHITE",
    "JOHN Q ADAMS",
    "MILES DAVIS",
] as const;

const PASSING_SHA: Record<string, string> = {
    "MAAR-left": "66a0d8fd8d5e984ac87e00cb15e6bae504d63b07102a104ac496c75aad0848e3",
    "MAAR-right": "c2c11eda41393861a7f3a901a99bd7227613404519d4992ff7725fb7e9e0db4d",
    "MANDIS KAAR-left": "689422cde139fd2d0a20da1bd77d88f63a7ddc864660dd1f372655f9df3a3877",
    "MANDIS KAAR-right": "d59749b62e4caf8936b83bf274e2a89bac0ad0e53e5bc7ba6db4d6f94f555975",
    "notext-left": "a76ca52a70e5740eb71f111e3f35b9f3a2e9f6f66f463246f2a3853253bed841",
    "notext-right": "67ebe8f71e9110e6a4b407c5356053b173f3cb13e15f8aab005d72cc64bbaf93",
};

/** Maar design ffcfa6f9 — US 6.5 medium, corrections 0, apex-belt-v2. */
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
    if (design.shapeFinish) design.shapeFinish = { ...design.shapeFinish, linked: true };
    return design;
}

function install(design: DesignState): void {
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

async function primeHarness(): Promise<{ sampleTop: ArrayBuffer; fontBytes: ArrayBuffer }> {
    resetSampleTopGeometryCache();
    const bytes = readFileSync(SAMPLE_TOP);
    const sampleTop = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    primeSampleTopGeometry(await sampleTopFromArrayBuffer(sampleTop));
    const font = readFileSync(FONT);
    const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
    primeTextFont(fontBytes);
    return { sampleTop, fontBytes };
}

async function engrave(name: string | null, side: Side, usMenSize: number): Promise<ArrayBuffer> {
    const { sampleTop, fontBytes } = await primeHarness();
    const design = maarDesign(usMenSize);
    if (name) {
        design.textMarking = markingWithComposedText(
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
    } else {
        design.textMarking = {
            ...defaultTextMarking("bottom"),
            text: "",
            addPatientName: false,
            feet: "both",
        };
    }
    install(design);
    const head = await buildFinalizedFootFromSavedSettings({
        settingsJson: designSettingsEnvelope(design as unknown as Record<string, unknown>),
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

function plantarView(p: TextXy): TextXy {
    return { x: p.x, y: -p.y };
}

describe("PR #461 grader G3 — manifold guard not loosened", () => {
    test("boolean.ts and manufacturing-foot-guard.ts are unchanged vs main", () => {
        const diff = execSync(
            "git diff origin/main 62aadfee66bab1cbeac9c8dd88bb8eadafa63488 -- vertex/src/lib/geometry/text-marking/boolean.ts vertex/src/lib/geometry/procedural-wall/manufacturing-foot-guard.ts",
            { cwd: REPO_ROOT, encoding: "utf8" },
        );
        expect(diff.trim()).toBe("");
    });

    test("assertExactManifold still uses tolerance 0", () => {
        const src = readFileSync(
            resolve(REPO_ROOT, "vertex/src/lib/geometry/text-marking/boolean.ts"),
            "utf8",
        );
        expect(src).toContain("assertExactManifold");
        expect(src).toMatch(/tolerance:\s*0/);
        expect(src).not.toMatch(/tolerance:\s*0\.0[1-9]/);
    });

    test("repair runs only after the exact check throws", () => {
        const src = execSync(
            "git show 62aadfee66bab1cbeac9c8dd88bb8eadafa63488:vertex/src/lib/geometry/text-marking/bottom-engrave.ts",
            {
                cwd: REPO_ROOT,
                encoding: "utf8",
            },
        );
        expect(src).toMatch(/assertExactManifold/);
        expect(src).toMatch(/stitchOpenEngraveSeam/);
        expect(src).toMatch(/dropDisconnectedSolePatches/);
        expect(src).toMatch(/repaired only after the exact check throws/i);
    });
});

describe("PR #461 grader G5 — UI pair export failure surfaces foot", () => {
    test("export panel prefixes the failed side and refuses partial downloads", () => {
        const src = execSync(
            "git show 62aadfee66bab1cbeac9c8dd88bb8eadafa63488:vertex/src/features/exports/export-panel-clinical.ts",
            {
                cwd: REPO_ROOT,
                encoding: "utf8",
            },
        );
        expect(src).toMatch(/No files were downloaded/);
        expect(src).toMatch(/G-code failed/);
        expect(src).toMatch(/SIDE_LABELS/);
    });
});

heavy("PR #461 grader G4 — byte-identical passing meshes", () => {
    test("MAAR, MANDIS KAAR, and no-text stay byte-identical at US M6.5", async () => {
        const cases: Array<{ label: string; name: string | null }> = [
            { label: "MAAR", name: "MAAR" },
            { label: "MANDIS KAAR", name: "MANDIS KAAR" },
            { label: "notext", name: null },
        ];
        const mismatches: string[] = [];
        for (const { label, name } of cases) {
            for (const side of ["left", "right"] as const) {
                const stl = await engrave(name, side, 6.5);
                const got = sha256(stl);
                const want = PASSING_SHA[`${label}-${side}`];
                if (got !== want) mismatches.push(`${label} ${side} got=${got} want=${want}`);
            }
        }
        expect(mismatches).toEqual([]);
    }, 600_000);
});

heavy("PR #461 grader G1 — KANDIS MAAR Maar settings", () => {
    test("passes the unchanged manufacturing foot guard on both feet with readable plantar text", async () => {
        const name = "KANDIS MAAR";
        const font = await loadTextFont();
        const marking = normalizeBottomTextMarking({
            ...defaultTextMarking("bottom"),
            text: "",
            addPatientName: true,
            feet: "both",
        });
        const flat = flattenText(font, name, marking.capHeightMm, marking.letterSpacingMm, marking.bold);

        for (const side of ["left", "right"] as const) {
            const stl = await engrave(name, side, 6.5);
            const pos = stlPositions(stl);
            const design = maarDesign(6.5);
            const { sampleTop } = await primeHarness();
            const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
            const foot = await composedFootRim(fresh, design, side);
            fresh.dispose();
            expect(plantarNameEngraved(pos, foot), `${side} plantar name`).toBe(true);
            expect(new DataView(stl).getUint32(80, true), `${side} triangles`).toBeGreaterThan(10_000);

            const bytes = readFileSync(SAMPLE_TOP);
            let raw = await sampleTopFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            );
            if (side === "right") {
                const { mirrorGeometry } = await import("@/lib/library/loaders");
                const mirrored = mirrorGeometry(raw);
                raw.dispose();
                raw = mirrored;
            }
            const { reconstructProceduralPreview } = await import(
                "@/lib/geometry/procedural-wall/sample-top-preview"
            );
            const zero = design.corrections[side];
            const preview = await reconstructProceduralPreview(raw, {
                corrections: { ...zero },
            });
            const ctx = extractHostTextContext(preview.geometry);
            const placed = placeBottomText(preview.geometry, ctx, { ...marking, text: name }, flat, side);
            const ordered = [...placed.meta.centroids].sort((a, b) => plantarView(a).x - plantarView(b).x);
            const left = ordered[0];
            const right = ordered[ordered.length - 1];
            expect(left && right, `${side} glyph centroids`).toBeTruthy();
            if (!left || !right) continue;
            const advance = plantarView(right).x - plantarView(left).x;
            expect(advance, `${side} reads left-to-right from below`).toBeGreaterThan(20);
            preview.geometry.dispose();
            raw.dispose();
        }
    }, 600_000);
});

describe("PR #461 grader G2 — independent realistic name matrix", () => {
    test("grader names are disjoint from the worker sweep", () => {
        expect(GRADER_NAMES.length).toBeGreaterThanOrEqual(16);
        const overlap = GRADER_NAMES.filter((n) => WORKER_SWEEP_NAMES.has(n) && n !== "KATE WONG");
        expect(overlap).toEqual([]);
        for (const name of GRADER_NAMES) {
            const words = name.split(" ");
            expect(words.length).toBeGreaterThanOrEqual(2);
            expect(words.length).toBeLessThanOrEqual(3);
            expect(name.length).toBeGreaterThanOrEqual(8);
            expect(name.length).toBeLessThanOrEqual(24);
        }
        const letters = new Set<string>();
        for (const name of GRADER_NAMES) {
            for (const ch of name) {
                if (ch >= "A" && ch <= "Z") letters.add(ch);
            }
        }
        for (const need of ["K", "D", "W", "M", "Q", "S", "G"]) {
            expect(letters.has(need), `missing ${need}`).toBe(true);
        }
    });

    (HAS_PR461_REPAIR ? test : test.skip)(
        "each grader name passes the guard and keeps plantar geometry at US M6 and M10",
        async () => {
            for (const name of GRADER_NAMES) {
                for (const usMenSize of [6, 10] as const) {
                    for (const side of ["left", "right"] as const) {
                        const stl = await engrave(name, side, usMenSize);
                        const pos = stlPositions(stl);
                        const design = maarDesign(usMenSize);
                        const { sampleTop } = await primeHarness();
                        const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
                        const foot = await composedFootRim(fresh, design, side);
                        fresh.dispose();
                        expect(plantarNameEngraved(pos, foot), `${name} M${usMenSize} ${side}`).toBe(true);
                        expect(
                            new DataView(stl).getUint32(80, true),
                            `${name} M${usMenSize} ${side}`,
                        ).toBeGreaterThan(10_000);
                    }
                }
            }
        },
        2_400_000,
    );
});
