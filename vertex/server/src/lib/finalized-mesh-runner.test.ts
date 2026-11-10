// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";
import { manifestEntryForKind } from "@/lib/geometry/element-assets/element-asset";
import { anchorPositionFromSidecar } from "@/lib/geometry/element-assets/sizing";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { PlacedElement } from "@/types";
import { defaultBottomTextMarking } from "../../../shared/bottom-text-marking.js";
import { designSettingsEnvelope } from "../../../shared/design-settings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERTEX_CWD = resolve(HERE, "../../..");
const REPO_ROOT = resolve(VERTEX_CWD, "..");
const PLACEHOLDER_NAME = "PLACEHOLDER";

interface FootParity {
    leftUpload: number;
    leftSolid: number;
    leftFingerprint: string;
    leftAgainFingerprint: string;
    leftAgainUpload: number;
    leftReferenceUpload: number;
    leftReferenceSolid: number;
    leftReferenceFingerprint: string;
    rightUpload: number;
    rightSolid: number;
    rightFingerprint: string;
    rightReferenceUpload: number;
    rightReferenceFingerprint: string;
}

interface ParityReport {
    fontPath: string;
    loftPath: string;
    elementsPath: string;
    vertexCwd: string;
    fontExists: boolean;
    loftExists: boolean;
    elementsExists: boolean;
    emptySnapshotMessage: string;
    name: FootParity;
    element: {
        upload: number;
        solid: number;
        fingerprint: string;
        againFingerprint: string;
        againUpload: number;
        warnings: string;
    };
}

function namedSnapshot(elements: PlacedElement[] = []) {
    const design = createDesignWithStockPlaceholder();
    design.textMarking = {
        ...defaultBottomTextMarking(),
        text: PLACEHOLDER_NAME,
        addPatientName: true,
    };
    design.elements = elements;
    return designSettingsEnvelope(design as unknown as Record<string, unknown>);
}

function copyFileBytes(path: string): ArrayBuffer {
    const buf = readFileSync(path);
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return copy;
}

async function metBarElement(): Promise<PlacedElement> {
    const bytes = copyFileBytes(resolve(VERTEX_CWD, "public/Templates/SAMPLE_Top.glb"));
    const raw = await sampleTopFromArrayBuffer(bytes);
    const leftTop = mirrorGeometry(raw);
    raw.dispose();
    const entry = await manifestEntryForKind("met_bar");
    if (!entry) throw new Error("met_bar is missing from the element manifest");
    const pose = anchorPositionFromSidecar(leftTop, "left", entry.sidecar);
    leftTop.dispose();
    return {
        id: "met_bar_1",
        kind: "met_bar",
        side: "left",
        position: { x: pose.x, y: pose.y },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        heightMm: entry.sidecar.nominalPeakMm,
    };
}

function runHeadlessParity(namePath: string, elementPath: string, reportPath: string): void {
    execFileSync(process.execPath, ["scripts/bundle-canonical-export-loft.mjs"], {
        cwd: VERTEX_CWD,
        stdio: "inherit",
    });
    execFileSync(
        process.execPath,
        [
            "--experimental-strip-types",
            resolve(HERE, "finalized-mesh-runner.parity.mjs"),
            namePath,
            elementPath,
            reportPath,
        ],
        { cwd: REPO_ROOT, stdio: "inherit" },
    );
}

describe("headless canonical export assets", () => {
    test("font, elements, and the placeholder-name loft do not depend on cwd", async () => {
        const dir = mkdtempSync(join(tmpdir(), "canonical-export-loft-"));
        const namePath = join(dir, "name.json");
        const elementPath = join(dir, "element.json");
        const reportPath = join(dir, "report.json");
        writeFileSync(namePath, JSON.stringify(namedSnapshot()));
        writeFileSync(elementPath, JSON.stringify(namedSnapshot([await metBarElement()])));
        runHeadlessParity(namePath, elementPath, reportPath);
        const report = JSON.parse(readFileSync(reportPath, "utf8")) as ParityReport;

        expect(report.loftPath.endsWith("canonical-export-loft.js")).toBe(true);
        expect(report.fontPath.endsWith("Inter-Bold.ttf")).toBe(true);
        expect(report.elementsPath.endsWith("elements") || report.elementsPath.endsWith("elements/")).toBe(
            true,
        );
        expect(report.loftExists).toBe(true);
        expect(report.fontExists).toBe(true);
        expect(report.elementsExists).toBe(true);
        expect(report.fontPath.startsWith(VERTEX_CWD)).toBe(true);
        expect(report.loftPath.startsWith(VERTEX_CWD)).toBe(true);
        expect(report.emptySnapshotMessage).toContain("Design has no saved parameter snapshot");
        expect(report.emptySnapshotMessage).not.toContain("Failed to parse URL");

        const name = report.name;
        expect(name.leftUpload).toBeGreaterThan(name.leftSolid);
        expect(name.leftFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(name.leftUpload).toBe(name.leftReferenceUpload);
        expect(name.leftSolid).toBe(name.leftReferenceSolid);
        expect(name.leftFingerprint).toBe(name.leftReferenceFingerprint);
        expect(name.leftAgainFingerprint).toBe(name.leftFingerprint);
        expect(name.leftAgainUpload).toBe(name.leftUpload);
        expect(name.rightUpload).toBeGreaterThan(name.rightSolid);
        expect(name.rightUpload).toBe(name.rightReferenceUpload);
        expect(name.rightFingerprint).toBe(name.rightReferenceFingerprint);
        expect(name.rightFingerprint).not.toBe(name.leftFingerprint);

        const element = report.element;
        expect(element.warnings).not.toContain("skip met_bar");
        expect(element.upload).toBeGreaterThan(element.solid);
        expect(element.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(element.againFingerprint).toBe(element.fingerprint);
        expect(element.againUpload).toBe(element.upload);
        expect(element.fingerprint).not.toBe(name.leftFingerprint);
    }, 1_200_000);
});
