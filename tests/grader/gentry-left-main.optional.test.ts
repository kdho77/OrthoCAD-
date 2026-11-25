// Left foot of the narrow incident, compared with the bytes recorded on this commit.
// Run the same file on the PR base to prove the left foot never takes the mirror.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { defaultElementPose } from "@/lib/geometry/elements";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, Side } from "@/types";
import {
    defaultBottomTextMarking,
    markingWithComposedText,
    normalizeBottomTextMarking,
} from "../../vertex/shared/bottom-text-marking";
import { designSettingsEnvelope } from "../../vertex/shared/design-settings";

const SYNTHETIC = "JABBOUR";
const SAMPLE = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf");
const ELEMENTS = resolve(process.cwd(), "vertex/public/elements");

/** Production belt STL of the US M6 left incident foot, including the leader. */
const M6_LEFT_BELT = "98593b60ca43b6f094daa1505bbc22dc9c29fe27a59e3c829a9425672f5a9608";

function incident(side: Side): DesignState {
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
    design.elements = (["left", "right"] as const).map((foot) => {
        const pose = defaultElementPose("met_pad", foot, layout.lengthMm, layout.widthMm);
        return {
            id: `met-${foot}`,
            kind: "met_pad" as const,
            side: foot,
            position: pose.position,
            rotationDeg: pose.rotationDeg,
            scale: pose.scale,
            heightMm: pose.heightMm,
            ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
        };
    });
    const marking = normalizeBottomTextMarking({
        ...defaultBottomTextMarking(),
        text: "",
        addPatientName: true,
        feet: "both",
        mode: "engrave",
    });
    design.textMarking = markingWithComposedText(marking, side, SYNTHETIC);
    return design;
}

describe("gentry left foot versus the recorded belt bytes", () => {
    test("US M6 left incident STL matches the graded bytes", async () => {
        const sample = readFileSync(SAMPLE);
        const sampleTop = sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength);
        const fontFile = readFileSync(FONT);
        const fontBytes = fontFile.buffer.slice(
            fontFile.byteOffset,
            fontFile.byteOffset + fontFile.byteLength,
        );
        resetSampleTopGeometryCache();
        resetManufacturingSolidCache();
        primeSampleTopGeometry(await sampleTopFromArrayBuffer(sampleTop.slice(0)));
        primeTextFont(fontBytes.slice(0));
        useBottomPatternStore.getState().clear();
        useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
        const saved = incident("left");
        expect(saved.textMarking?.text).toBe(SYNTHETIC);
        const viewer = useDesignStore.getState().viewer;
        useDesignStore.setState({ design: saved, viewer: { ...viewer, wallModel: "procedural" } });
        const head = await buildFinalizedFootFromSavedSettings({
            settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
            side: "left",
            sampleTopBytes: sampleTop,
            includeLeader: true,
            fontBytes,
            elementsBaseDir: ELEMENTS,
        });
        const hash = createHash("sha256").update(Buffer.from(head.stl)).digest("hex");
        expect(hash).toBe(M6_LEFT_BELT);
    }, 900_000);
});
