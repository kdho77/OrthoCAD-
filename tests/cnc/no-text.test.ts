// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { designWithoutText, workpiecesFromDesign } from "@/lib/cnc/compose";
import { generateCncJob } from "@/lib/cnc/export";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { defaultSideShapeFinish } from "@/lib/geometry/shape-finish-modifiers";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, TextSurface } from "@/types";
import { loadSampleTop } from "./helpers";

const TEXT_KEYS = ["textMarking", "textGuide", "textFitError", "bottomOutlineWorld", "outlineWorld"];

function millDesign(surface: TextSurface, text: string): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "milling_3axis";
    design.usMenSize = 9;
    if (design.paired) {
        design.paired.leftMethod = "milling_3axis";
        design.paired.rightMethod = "milling_3axis";
    }
    const mill = defaultSideShapeFinish("milling_3axis");
    design.shapeFinish = { left: mill, right: { ...mill }, linked: true };
    design.textMarking = { ...defaultTextMarking(surface), text, feet: "both" };
    return design;
}

function samePositions(a: BufferGeometry | null | undefined, b: BufferGeometry | null | undefined): boolean {
    const pa = a?.getAttribute("position");
    const pb = b?.getAttribute("position");
    if (!pa || !pb || pa.count !== pb.count) return false;
    for (let i = 0; i < pa.count; i++) {
        if (pa.getX(i) !== pb.getX(i) || pa.getY(i) !== pb.getY(i) || pa.getZ(i) !== pb.getZ(i)) return false;
    }
    return true;
}

describe("CNC never cuts text", () => {
    test("designWithoutText drops bottom and wall input", () => {
        const design = millDesign("bottom", "DONAHUE");
        const stripped = designWithoutText(design);
        expect(design.textMarking?.text).toBe("DONAHUE");
        expect(stripped.textMarking).toBeUndefined();
        expect(stripped.method).toBe("milling_3axis");
    });

    test("milled mesh matches the no-text order for bottom and wall text", async () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const raw = await loadSampleTop();
        const load = async (side: "left" | "right") => {
            const geo = raw.clone();
            return side === "right" ? mirrorGeometry(geo) : geo;
        };
        const plain = millDesign("bottom", "");
        plain.textMarking = undefined;
        try {
            const bare = await workpiecesFromDesign(plain, ["left", "right"], profile, load);
            expect(bare).toHaveLength(2);
            for (const surface of ["bottom", "wall"] as const) {
                const name = surface === "bottom" ? "DONAHUE" : "DUNNAGAN";
                const marked = millDesign(surface, name);
                const before = marked.textMarking?.text;
                const parts = await workpiecesFromDesign(marked, ["left", "right"], profile, load);
                expect(marked.textMarking?.text).toBe(before);
                expect(parts).toHaveLength(2);
                for (let i = 0; i < parts.length; i++) {
                    expect(samePositions(parts[i]?.mesh, bare[i]?.mesh)).toBe(true);
                    const ud = (parts[i]?.mesh?.userData ?? {}) as Record<string, unknown>;
                    for (const key of TEXT_KEYS) expect(ud[key]).toBeUndefined();
                }
                const job = generateCncJob(profile, parts);
                expect(job.gcode).toContain("; foot: left+right");
                expect(job.gcode.includes(name)).toBe(false);
                for (const part of parts) part.mesh?.dispose();
            }
            for (const part of bare) part.mesh?.dispose();
        } finally {
            raw.dispose();
        }
    }, 180_000);
});
