// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// The STL the bot sends: SAMPLE_Top, both feet, default bottom textMarking,
// engrave, name JABBOUR, buildPrinterFootManufacturingStl(side, true).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { printerFootStlFacts } from "@/features/exports/printer-foot-isolation";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { composeMarkingTextForSide } from "@/lib/geometry/text-marking/compose";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import { markingWithComposedText } from "../../vertex/shared/bottom-text-marking";
import { designSettingsEnvelope } from "../../vertex/shared/design-settings";
import { SYNTHETIC_NAME } from "./thresholds";

const originalFetch = globalThis.fetch;

function installSampleTop(): void {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    globalThis.fetch = async (input) => {
        const url = String(input);
        if (!url.includes("SAMPLE_Top")) throw new Error(`unexpected fetch ${url}`);
        return new Response(bytes);
    };
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.textMarking = {
        ...defaultTextMarking("bottom"),
        text: SYNTHETIC_NAME,
        feet: "both",
        mode: "engrave",
    };
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
});

describe("plantar-name manufacturing STLs", () => {
    test("both feet are the belt STL the bot sends, with JABBOUR engraved", async () => {
        installSampleTop();
        const marking = useDesignStore.getState().design.textMarking!;
        expect(marking.surface).toBe("bottom");
        expect(marking.mode).toBe("engrave");
        expect(marking.feet).toBe("both");
        expect(marking.bold).toBe(true);
        expect(marking.capHeightMm).toBe(12);
        expect(marking.depthMm).toBe(0.6);
        expect(composeMarkingTextForSide(marking, "left", null)).toBe(SYNTHETIC_NAME);
        expect(composeMarkingTextForSide(marking, "right", null)).toBe(SYNTHETIC_NAME);

        const outDir = process.env.NAME_PLANTAR_STL_DIR;
        if (outDir) mkdirSync(outDir, { recursive: true });
        const manifest: Record<string, number> = {};
        const bytes: Partial<Record<Side, Buffer>> = {};
        for (const side of ["left", "right"] as const) {
            const built = await buildPrinterFootManufacturingStl(side, true);
            expect(built.uploadTriangles, side).toBeGreaterThan(built.solidTriangles);
            expect(built.solidTriangles, side).toBeGreaterThan(1000);
            const facts = printerFootStlFacts(built.stl);
            expect(facts.side, side).toBe(side);
            expect(facts.triangleCount, side).toBe(built.uploadTriangles);
            const file = Buffer.from(built.stl);
            bytes[side] = file;
            manifest[`${side}Solid`] = built.solidTriangles;
            manifest[`${side}Upload`] = built.uploadTriangles;
            if (outDir) writeFileSync(join(outDir, `${side}.stl`), file);
        }
        expect(bytes.left!.equals(bytes.right!)).toBe(false);
        if (outDir) writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }, 600_000);
});

/**
 * Production path for the designs that diverged after the belt reflection.
 * Synthetic name only. 0d3db1c0: Medium, unlinked, US men 11.5, right heel lift
 * 12 mm, pair and single, addPatientName composition. ad1e0cc5: linked Medium
 * pair with the name in the extra line, and the same pair with addPatientName.
 * Both go through buildFinalizedFootFromSavedSettings, which is what
 * materializeCadOperatorStl lofts.
 */
function productionEnvelope(design: DesignState, side: Side): unknown {
    const envelope = designSettingsEnvelope(design as unknown as Record<string, unknown>);
    const marking = design.textMarking ?? defaultTextMarking("bottom");
    const composed = markingWithComposedText(marking, side, SYNTHETIC_NAME);
    return designSettingsEnvelope({
        ...envelope.settings,
        textMarking: composed,
    });
}

function sampleTopBytes(): ArrayBuffer {
    const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function singleFoot(design: DesignState, side: Side): DesignState {
    const paired = design.paired ? { ...design.paired } : undefined;
    if (!paired) return design;
    if (side === "left") {
        return { ...design, paired: { ...paired, rightBase: undefined } };
    }
    return { ...design, base: undefined, paired: { ...paired, leftBase: undefined } };
}

describe("production-path plantar-name variants", () => {
    test("0d3db1c0 and ad1e0cc5 paths engrave JABBOUR on both feet", async () => {
        installSampleTop();
        const sampleTop = sampleTopBytes();
        const outDir = process.env.NAME_PLANTAR_STL_DIR;
        if (outDir) mkdirSync(outDir, { recursive: true });

        const mediumUnlinked = createDesignWithStockPlaceholder();
        mediumUnlinked.method = "printing_solid";
        mediumUnlinked.shoeWidth = "medium";
        mediumUnlinked.usMenSize = 11.5;
        mediumUnlinked.corrections = {
            ...mediumUnlinked.corrections,
            linked: false,
            right: { ...mediumUnlinked.corrections.right, heelLiftMm: 12 },
        };
        mediumUnlinked.textMarking = {
            ...defaultTextMarking("bottom"),
            text: "",
            addPatientName: true,
            feet: "both",
            mode: "engrave",
        };
        expect(composeMarkingTextForSide(mediumUnlinked.textMarking, "left", SYNTHETIC_NAME)).toBe(
            SYNTHETIC_NAME,
        );
        expect(composeMarkingTextForSide(mediumUnlinked.textMarking, "right", SYNTHETIC_NAME)).toBe(
            SYNTHETIC_NAME,
        );

        const linkedExplicit = createDesignWithStockPlaceholder();
        linkedExplicit.method = "printing_solid";
        linkedExplicit.shoeWidth = "medium";
        linkedExplicit.corrections = { ...linkedExplicit.corrections, linked: true };
        linkedExplicit.textMarking = {
            ...defaultTextMarking("bottom"),
            text: SYNTHETIC_NAME,
            addPatientName: false,
            feet: "both",
            mode: "engrave",
        };

        const linkedNamed = createDesignWithStockPlaceholder();
        linkedNamed.method = "printing_solid";
        linkedNamed.shoeWidth = "medium";
        linkedNamed.corrections = { ...linkedNamed.corrections, linked: true };
        linkedNamed.textMarking = {
            ...defaultTextMarking("bottom"),
            text: "",
            addPatientName: true,
            feet: "both",
            mode: "engrave",
        };

        const jobs: Array<{ file: string; design: DesignState; side: Side }> = [
            { file: "d0-pair-left", design: mediumUnlinked, side: "left" },
            { file: "d0-pair-right", design: mediumUnlinked, side: "right" },
            { file: "d0-single-left", design: singleFoot(mediumUnlinked, "left"), side: "left" },
            { file: "d0-single-right", design: singleFoot(mediumUnlinked, "right"), side: "right" },
            { file: "ad-pair-left", design: linkedExplicit, side: "left" },
            { file: "ad-pair-right", design: linkedExplicit, side: "right" },
            { file: "ad-name-left", design: linkedNamed, side: "left" },
            { file: "ad-name-right", design: linkedNamed, side: "right" },
        ];

        const hashes = new Map<string, string>();
        for (const job of jobs) {
            const built = await buildFinalizedFootFromSavedSettings({
                settingsJson: productionEnvelope(job.design, job.side),
                side: job.side,
                sampleTopBytes: sampleTop,
                includeLeader: true,
            });
            expect(built.uploadTriangles, job.file).toBeGreaterThan(built.solidTriangles);
            expect(built.fingerprint, job.file).toMatch(/^[a-f0-9]{64}$/);
            const facts = printerFootStlFacts(built.stl);
            expect(facts.side, job.file).toBe(job.side);
            const file = Buffer.from(built.stl);
            expect(file.byteLength, job.file).not.toBe(9045484);
            hashes.set(job.file, file.toString("base64").slice(0, 80) + file.byteLength);
            if (outDir) writeFileSync(join(outDir, `${job.file}.stl`), file);
        }
        expect(hashes.get("d0-pair-left")).not.toBe(hashes.get("d0-pair-right"));
        expect(hashes.get("ad-pair-left")).not.toBe(hashes.get("ad-pair-right"));
        expect(hashes.get("d0-pair-left")).not.toBe(hashes.get("ad-pair-left"));
        expect(hashes.get("d0-single-right")).not.toBe(hashes.get("d0-pair-left"));
    }, 1_200_000);
});
