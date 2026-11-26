// One-shot capture of main-branch STL sha256 for G4. Not registered in CI shards.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
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
const OUT = resolve(process.cwd(), "tests/fixtures/pr461-main-baseline/6.5");

function maarDesign(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.usMenSize = 6.5;
    design.shoeWidth = "medium";
    design.printRecipe = design.printRecipe
        ? { ...design.printRecipe, defaultHardness: "Hard", profileId: "apex-belt-v2" }
        : design.printRecipe;
    return design;
}

function install(design: DesignState): void {
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
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

describe("capture main baselines", () => {
    test("write sha256 pins", async () => {
        const sampleTop = await prime();
        const font = readFileSync(FONT);
        const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
        mkdirSync(OUT, { recursive: true });
        const cases: Array<{ label: string; name: string | null; side: Side }> = [];
        for (const side of ["left", "right"] as const) {
            for (const name of ["MAAR", "MANDIS KAAR", null] as const) {
                cases.push({ label: name ?? "notext", name, side });
            }
        }
        for (const { label, name, side } of cases) {
            const design = maarDesign();
            if (name) {
                design.textMarking = markingWithComposedText(
                    { ...defaultTextMarking("bottom"), text: "", addPatientName: true, feet: "both" },
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
            const sha = createHash("sha256").update(Buffer.from(head.stl)).digest("hex");
            writeFileSync(resolve(OUT, `${label}-${side}.sha256`), `${sha}\n`);
            expect(sha.length).toBe(64);
        }
    }, 900_000);
});
