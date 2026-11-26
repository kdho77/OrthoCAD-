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
import { markingWithComposedText } from "../../../../shared/bottom-text-marking";
import { designSettingsEnvelope } from "../../../../shared/design-settings";

const SAMPLE_TOP = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf");

/**
 * Two or three words, 4–24 characters. Together they use every A–Z letter,
 * one apostrophe, and one hyphen. KATE WONG is the case the manifold guard
 * rejected on a US men's 10 right foot.
 */
const REALISTIC_NAMES = [
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
] as const;

/** STL sha256 at PR #461 head 4d223923 for the meshes that already passed. */
const PASSING_SHA: Record<string, string> = {
    "MAAR-left": "66a0d8fd8d5e984ac87e00cb15e6bae504d63b07102a104ac496c75aad0848e3",
    "MAAR-right": "c2c11eda41393861a7f3a901a99bd7227613404519d4992ff7725fb7e9e0db4d",
    "MANDIS KAAR-left": "689422cde139fd2d0a20da1bd77d88f63a7ddc864660dd1f372655f9df3a3877",
    "MANDIS KAAR-right": "d59749b62e4caf8936b83bf274e2a89bac0ad0e53e5bc7ba6db4d6f94f555975",
    "notext-left": "a76ca52a70e5740eb71f111e3f35b9f3a2e9f6f66f463246f2a3853253bed841",
    "notext-right": "67ebe8f71e9110e6a4b407c5356053b173f3cb13e15f8aab005d72cc64bbaf93",
    "KANDIS MAAR-left": "4b2741c130a788b2e7513acd87d1961dc4ccbf31bb3d503af813d11caad4b000",
    "KANDIS MAAR-right": "05a3cc0b040081ea23192778b334039a0d7037c3b522ead6f28844569c81ec1f",
};

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

describe("plantar name sweep", () => {
    test("the name list covers A-Z, an apostrophe, and a hyphen", () => {
        const letters = new Set<string>();
        let apostrophe = false;
        let hyphen = false;
        expect(REALISTIC_NAMES.length).toBeGreaterThanOrEqual(20);
        for (const name of REALISTIC_NAMES) {
            const words = name.split(" ");
            expect(words.length).toBeGreaterThanOrEqual(2);
            expect(words.length).toBeLessThanOrEqual(3);
            expect(name.length).toBeGreaterThanOrEqual(4);
            expect(name.length).toBeLessThanOrEqual(24);
            for (const ch of name) {
                if (ch >= "A" && ch <= "Z") letters.add(ch);
                if (ch === "'") apostrophe = true;
                if (ch === "-") hyphen = true;
            }
        }
        expect(letters.size).toBe(26);
        expect(apostrophe).toBe(true);
        expect(hyphen).toBe(true);
    });

    test("MAAR, MANDIS KAAR, KANDIS MAAR, and no-text stay byte-identical", async () => {
        const cases: Array<{ label: string; name: string | null }> = [
            { label: "MAAR", name: "MAAR" },
            { label: "MANDIS KAAR", name: "MANDIS KAAR" },
            { label: "KANDIS MAAR", name: "KANDIS MAAR" },
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
    }, 900_000);

    test("realistic names engrave on both feet at US M6 and M10", async () => {
        for (const name of REALISTIC_NAMES) {
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
                    expect(new DataView(stl).getUint32(80, true), `${name} M${usMenSize} ${side}`).toBeGreaterThan(
                        10_000,
                    );
                }
            }
        }
    }, 2_400_000);
});
