// Copyright (c) 2026 Vertex Orthopedic. Independent grader for PR #469 (do not merge).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { defaultElementPose } from "@/lib/geometry/elements";
import { buildExportStl } from "@/lib/geometry/export-geometry";
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
    composedFootRim,
    meshOutlineIoU,
    plantarNameEngraved,
    stlPositions,
} from "./manufacturing-foot-guard";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";
import { PRELOFT_HEADING_MAX_DEG, SKEW_INSET_RATIO, snapStationsInsidePreLoftCap } from "./station-gates";

const REPO = resolve(process.cwd());
const PR_HEAD = "b4a7ea7fbf00fe96768002d03241df3b92735f91";
const SAMPLE_TOP = resolve(REPO, "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(REPO, "vertex/public/fonts/Inter-Bold.ttf");
const PATIENT = "GRADER";

const WIDTH_CHANGE_PATCH = {
    heelCupDepthMm: 12,
    heelCupHeightMm: 9,
    heelCupWidthMm: 0,
    heelLiftMm: 4,
    medialFlangeMm: 3,
    lateralFlangeMm: 2,
    rearfootWedge: {
        side: "medial" as const,
        value: 4,
        unit: "deg" as const,
        degreeMode: "station" as const,
    },
    forefootWedge: {
        side: "lateral" as const,
        value: 3,
        unit: "deg" as const,
        degreeMode: "station" as const,
    },
};

function gitShowMain(path: string): string {
    return execSync(`git show main:${path}`, { cwd: REPO, encoding: "utf8" });
}

function functionBody(source: string, name: string): string {
    const needle = `export function ${name}`;
    const start = source.indexOf(needle);
    if (start < 0) throw new Error(`missing ${name}`);
    const after = source.slice(start);
    const nextExport = after.indexOf("\nexport function ", 1);
    return nextExport < 0 ? after : after.slice(0, nextExport);
}

function graderReportedDesign(usMenSize: number): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.usMenSize = usMenSize;
    design.shoeWidth = "narrow";
    design.shoeWidthBySide = { left: "narrow", right: "narrow" };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, ...WIDTH_CHANGE_PATCH },
        right: { ...design.corrections.right, ...WIDTH_CHANGE_PATCH },
    };
    const layout = insoleLayoutFromDesign(design);
    const elements: PlacedElement[] = [];
    for (const side of ["left", "right"] as const) {
        for (const kind of ["met_pad", "mortons_extension"] as const) {
            const pose = defaultElementPose(kind, side, layout.lengthMm, layout.widthMm);
            elements.push({
                id: `${kind}-${side}`,
                kind,
                side,
                position: pose.position,
                rotationDeg: pose.rotationDeg,
                scale: pose.scale,
                heightMm: pose.heightMm,
                ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
            });
        }
    }
    design.elements = elements;
    return design;
}

function installDesign(design: DesignState): void {
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

function planOutline(positions: Float64Array): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
        out.push({ x: positions[i] ?? 0, y: positions[i + 1] ?? 0 });
    }
    return out;
}

describe("grader PR #469", () => {
    test("G-scope: PR #469 diff is only the four brief files", () => {
        const files = execSync(`git diff --name-only main...${PR_HEAD}`, { cwd: REPO, encoding: "utf8" })
            .trim()
            .split("\n")
            .filter(Boolean)
            .sort();
        expect(files).toEqual([
            "ci/unit-test-shards.json",
            "vertex/src/lib/geometry/procedural-wall/headless-canonical-preloft.test.ts",
            "vertex/src/lib/geometry/procedural-wall/reconstruct.ts",
            "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
        ]);
    });

    test("skew and heading caps match main (not loosened)", () => {
        expect(SKEW_INSET_RATIO).toBe(0.5);
        expect(PRELOFT_HEADING_MAX_DEG).toBe(15);
        const mainSrc = gitShowMain("vertex/src/lib/geometry/procedural-wall/station-gates.ts");
        expect(mainSrc).toMatch(/export const SKEW_INSET_RATIO = 0\.5;/);
        expect(mainSrc).toMatch(/export const PRELOFT_HEADING_MAX_DEG = 15;/);
    });

    test("assertPreLoftStations body is byte-identical to main", () => {
        const mainBody = functionBody(
            gitShowMain("vertex/src/lib/geometry/procedural-wall/station-gates.ts"),
            "assertPreLoftStations",
        );
        const headBody = functionBody(
            readFileSync(resolve(REPO, "vertex/src/lib/geometry/procedural-wall/station-gates.ts"), "utf8"),
            "assertPreLoftStations",
        );
        expect(headBody).toBe(mainBody);
    });

    test("reconstruct runs snap immediately before assert; main lacks snap", () => {
        const headRecon = readFileSync(
            resolve(REPO, "vertex/src/lib/geometry/procedural-wall/reconstruct.ts"),
            "utf8",
        );
        const snapAt = headRecon.indexOf("snapStationsInsidePreLoftCap(");
        const assertAt = headRecon.indexOf("assertPreLoftStations(", snapAt);
        expect(snapAt).toBeGreaterThan(0);
        expect(assertAt).toBeGreaterThan(snapAt);
        const mainRecon = gitShowMain("vertex/src/lib/geometry/procedural-wall/reconstruct.ts");
        expect(mainRecon).not.toContain("snapStationsInsidePreLoftCap");
    });

    test("G-invent: repro magnitudes are the width-change reported-design patch", () => {
        const workerSrc = readFileSync(
            resolve(REPO, "vertex/src/lib/geometry/procedural-wall/headless-canonical-preloft.test.ts"),
            "utf8",
        );
        for (const key of Object.keys(WIDTH_CHANGE_PATCH)) {
            expect(workerSrc).toContain(`${key}:`);
        }
    });

    test("snapStationsInsidePreLoftCap uses the existing cap ratio in source", () => {
        expect(typeof snapStationsInsidePreLoftCap).toBe("function");
        const snapBody = functionBody(
            readFileSync(resolve(REPO, "vertex/src/lib/geometry/procedural-wall/station-gates.ts"), "utf8"),
            "snapStationsInsidePreLoftCap",
        );
        expect(snapBody).toContain("SKEW_INSET_RATIO");
        expect(snapBody).toContain("const windowMm = 16");
    });

    test("reported narrow US M6/M9: headless canonical matches UI export (both feet, name engraved)", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP);
        const sampleTop = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        primeSampleTopGeometry(await sampleTopFromArrayBuffer(sampleTop.slice(0)));
        const font = readFileSync(FONT);
        const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
        primeTextFont(fontBytes.slice(0));
        const elementsBaseDir = resolve(REPO, "vertex/public/elements");

        for (const usMenSize of [6, 9] as const) {
            const design = graderReportedDesign(usMenSize);
            for (const side of ["left", "right"] as const satisfies readonly Side[]) {
                const composed = markingWithComposedText(
                    { ...defaultTextMarking("bottom"), text: "", addPatientName: true, feet: "both" },
                    side,
                    PATIENT,
                );
                const saved = { ...design, textMarking: composed };
                installDesign(saved);
                const uiStl = await buildExportStl(side, {
                    exportMode: "manufacturing",
                    beltPrint: true,
                });
                const head = await buildFinalizedFootFromSavedSettings({
                    settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                    side,
                    sampleTopBytes: sampleTop,
                    includeLeader: true,
                    fontBytes,
                    elementsBaseDir,
                });
                const uiPos = stlPositions(uiStl);
                const headPos = stlPositions(head.stl);
                const uiTris = new DataView(uiStl).getUint32(80, true);
                expect(head.solidTriangles, `M${usMenSize} ${side} triangles`).toBe(uiTris);
                expect(
                    meshOutlineIoU(headPos, planOutline(uiPos)),
                    `M${usMenSize} ${side} IoU`,
                ).toBeGreaterThanOrEqual(0.98);
                const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
                const foot = await composedFootRim(fresh, saved, side);
                fresh.dispose();
                expect(plantarNameEngraved(headPos, foot)).toBe(true);
                expect(plantarNameEngraved(uiPos, foot)).toBe(true);
            }
        }
    }, 900_000);
});
