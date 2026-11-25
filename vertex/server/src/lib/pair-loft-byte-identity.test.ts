// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// ad1e0cc5-style pair: linked Medium, name on the extra line, and the same pair
// with addPatientName. Both feet. Off-thread STL bytes must match the in-process
// loft main slices, and that STL is the VertexSlice model.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "@rstest/core";
import { composeMarkingTextForSide } from "@/lib/geometry/text-marking/compose";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import { SYNTHETIC_NAME } from "../../../../tests/name-plantar-e2e/thresholds.ts";
import { markingWithComposedText } from "../../../shared/bottom-text-marking.js";
import { designSettingsEnvelope } from "../../../shared/design-settings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERTEX_CWD = resolve(HERE, "../../..");
const REPO_ROOT = resolve(VERTEX_CWD, "..");

function productionEnvelope(design: DesignState, side: Side): unknown {
    const envelope = designSettingsEnvelope(design as unknown as Record<string, unknown>);
    const marking = design.textMarking ?? defaultTextMarking("bottom");
    const composed = markingWithComposedText(marking, side, SYNTHETIC_NAME);
    return designSettingsEnvelope({
        ...envelope.settings,
        textMarking: composed,
    });
}

interface FootReport {
    side: Side;
    equal: boolean;
    sha256: string;
    workerSha256: string;
    solidTriangles: number;
    uploadTriangles: number;
    workerUploadTriangles: number;
    fingerprintEqual: boolean;
    sliceModelEqualsStl: boolean;
    composedText: string;
}

describe("ad1e0cc5-style pair loft bytes", () => {
    test("both feet match the in-process STL main slices, with the patient name on each foot", () => {
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

        const jobs: Array<{ id: string; design: DesignState; side: Side }> = [
            { id: "extra-line-left", design: linkedExplicit, side: "left" },
            { id: "extra-line-right", design: linkedExplicit, side: "right" },
            { id: "patient-name-left", design: linkedNamed, side: "left" },
            { id: "patient-name-right", design: linkedNamed, side: "right" },
        ];
        const feet = jobs.map((job) => {
            const marking = job.design.textMarking ?? defaultTextMarking("bottom");
            const composedText = composeMarkingTextForSide(marking, job.side, SYNTHETIC_NAME);
            expect(composedText, job.id).toBe(SYNTHETIC_NAME);
            return {
                id: job.id,
                side: job.side,
                composedText,
                settingsJson: productionEnvelope(job.design, job.side),
            };
        });
        for (const foot of feet) {
            expect(JSON.stringify(foot.settingsJson), foot.id).toContain(SYNTHETIC_NAME);
        }

        const dir = mkdtempSync(join(tmpdir(), "pair-loft-bytes-"));
        const casesPath = join(dir, "cases.json");
        const reportPath = join(dir, "report.json");
        writeFileSync(casesPath, JSON.stringify({ patientName: SYNTHETIC_NAME, feet }));
        execFileSync(process.execPath, ["scripts/bundle-canonical-export-loft.mjs"], {
            cwd: VERTEX_CWD,
            stdio: "inherit",
        });
        execFileSync(
            process.execPath,
            [
                "--experimental-strip-types",
                resolve(HERE, "pair-loft-byte-identity.mjs"),
                casesPath,
                reportPath,
            ],
            { cwd: REPO_ROOT, stdio: "inherit" },
        );
        const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
            patientName: string;
            feet: Record<string, FootReport>;
        };
        expect(report.patientName).toBe(SYNTHETIC_NAME);
        for (const foot of feet) {
            const row = report.feet[foot.id];
            expect(row, foot.id).toBeDefined();
            expect(row?.side, foot.id).toBe(foot.side);
            expect(row?.composedText, foot.id).toBe(SYNTHETIC_NAME);
            expect(row?.equal, foot.id).toBe(true);
            expect(row?.fingerprintEqual, foot.id).toBe(true);
            expect(row?.sha256, foot.id).toBe(row?.workerSha256);
            expect(row?.uploadTriangles, foot.id).toBeGreaterThan(row?.solidTriangles ?? 0);
            expect(row?.workerUploadTriangles, foot.id).toBe(row?.uploadTriangles);
            expect(row?.sliceModelEqualsStl, foot.id).toBe(true);
        }
        expect(report.feet["extra-line-left"]?.sha256).not.toBe(report.feet["extra-line-right"]?.sha256);
        expect(report.feet["patient-name-left"]?.sha256).not.toBe(report.feet["patient-name-right"]?.sha256);
        // Both variants compose to JABBOUR on an otherwise identical linked Medium pair,
        // so main's loft emits one mesh per foot.
        expect(report.feet["extra-line-left"]?.sha256).toBe(report.feet["patient-name-left"]?.sha256);
        expect(report.feet["extra-line-right"]?.sha256).toBe(report.feet["patient-name-right"]?.sha256);
    }, 1_200_000);
});
