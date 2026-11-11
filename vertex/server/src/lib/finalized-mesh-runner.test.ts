// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { designStateFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { manifestEntryForKind } from "@/lib/geometry/element-assets/element-asset";
import { anchorPositionFromSidecar } from "@/lib/geometry/element-assets/sizing";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import type { PlacedElement, Side } from "@/types";
import { defaultBottomTextMarking } from "../../../shared/bottom-text-marking.js";
import {
    type DesignSettingsEnvelope,
    designSettingsEnvelope,
    readStoredDesignSettings,
} from "../../../shared/design-settings.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { envelopeWithLoftTextMarking, resolveProductionTextMarking } from "./integration-text-marking.js";
import { persistSavedDesignSnapshotOnDesign } from "./saved-design-snapshot.js";

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

interface GeometryCase {
    label: string;
    side: Side;
    settings: DesignSettingsEnvelope;
}

interface GeometryFootReport {
    solid: number;
    upload: number;
    fingerprint: string;
    sha256: string;
    stamp: Side | null;
    error: string | null;
}

interface GeometryReport {
    emptySnapshotMessage: string;
    cases: Record<string, GeometryFootReport>;
}

const PERSIST_DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const persistPrincipal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

function persistPrisma(shoeSize = 9) {
    const current = {
        id: PERSIST_DESIGN_ID,
        ownerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Fixture insole",
        kind: "insole",
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 2,
        linked: true,
        unit: "mm",
        settingsJson: null,
        updatedAt: "2026-11-06T00:00:00.000Z",
        deletedAt: null,
        client: { tenantId: DOGFOOD_TENANT_ID },
        integrationLink: {
            tenantId: DOGFOOD_TENANT_ID,
            source: "vo2",
            externalOrderId: "fixture-order",
            sides: "pair",
            shoeSizeSystem: "US_M",
            shoeSize,
            shoeSizeLeft: null,
            shoeSizeRight: null,
            shoeWidth: "medium",
            rxText: null,
            notes: null,
        },
    };
    return {
        design: {
            findUnique: async () => current,
            update: async () => ({ id: PERSIST_DESIGN_ID }),
        },
    } as unknown as PrismaClient;
}

/**
 * settingsJson from persistSavedDesignSnapshotOnDesign, then the same text
 * composition manufacturing.generateFromSavedDesign lofts.
 */
async function persistedLoftSettings(
    catalog: unknown,
    side: Side,
    shoeSize = 9,
): Promise<{ persisted: unknown; settings: DesignSettingsEnvelope }> {
    const saved = await persistSavedDesignSnapshotOnDesign({
        prisma: persistPrisma(shoeSize),
        principal: persistPrincipal,
        designId: PERSIST_DESIGN_ID,
        catalog,
    });
    const resolved = resolveProductionTextMarking({
        settingsJson: saved.settingsJson,
        patientNameOverride: "Jane Doe",
        clientDisplayName: null,
    });
    return {
        persisted: saved.settingsJson,
        settings: envelopeWithLoftTextMarking(resolved.envelope, resolved.patientDisplayName, side),
    };
}

function sideCorrection(settingsJson: unknown, side: Side) {
    const corrections = readStoredDesignSettings(settingsJson)?.corrections as
        | {
              left: {
                  archHeightMm: number;
                  apexMoveMm: number;
                  forefootWidthMm: number;
                  rearfootWedge?: Record<string, unknown>;
              };
              right: {
                  archHeightMm: number;
                  apexMoveMm: number;
                  forefootWidthMm: number;
                  rearfootWedge?: Record<string, unknown>;
              };
          }
        | undefined;
    if (!corrections) throw new Error("persisted snapshot has no corrections");
    return corrections[side];
}

function sha256(bytes: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/** Human Export STL for a saved design: same store install the UI uses before buildExportStl. */
async function canonicalExportSha(settings: GeometryCase["settings"], side: Side): Promise<string> {
    const design = designStateFromSavedSettings(settings);
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    usePreviewLoftStatusStore.setState({ printLoftEpoch: 0 });
    const sampleTop = readFileSync(resolve(VERTEX_CWD, "public/Templates/SAMPLE_Top.glb"));
    globalThis.fetch = async () => new Response(sampleTop);
    primeTextFont(copyFileBytes(resolve(VERTEX_CWD, "public/fonts/Inter-Bold.ttf")));
    useDesignStore.setState({
        design,
        viewer: {
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso",
            wallModel: "procedural",
        },
    });
    const built = await buildPrinterFootManufacturingStl(side, true);
    return sha256(built.stl);
}

describe("headless canonical export for non-default saved geometry", () => {
    test("persisted low arch with sinks and a lateral rearfoot wedge match Export", async () => {
        const shoe = { system: "US_M", size: 9 } as const;
        const low = await persistedLoftSettings(
            { shoe_size: shoe, arch: "low", sinks: [{ name: "1st met head", side: "left", depth_mm: 1.5 }] },
            "left",
        );
        expect(sideCorrection(low.persisted, "left").archHeightMm).toBe(-3.5);
        expect(sideCorrection(low.persisted, "right").archHeightMm).toBe(-3.5);
        const sinks = readStoredDesignSettings(low.persisted)?.sinks as {
            left?: Array<{ kind: string; depthMm: number; u?: number; v?: number }>;
        };
        expect(sinks.left?.[0]).toMatchObject({ kind: "mpj1", depthMm: 1.5 });
        expect(sinks.left?.[0]?.u).toBeUndefined();
        expect(sinks.left?.[0]?.v).toBeUndefined();
        expect(sideCorrection(low.settings, "left").archHeightMm).toBe(-3.5);

        const high = await persistedLoftSettings({ shoe_size: shoe, arch: "high" }, "left");
        expect(sideCorrection(high.persisted, "left").archHeightMm).toBe(3);

        const wedgeLeft = await persistedLoftSettings(
            { shoe_size: shoe, rearfoot_wedge: { side: "lateral", value: 3, unit: "mm" } },
            "left",
        );
        const wedgeRight = await persistedLoftSettings(
            { shoe_size: shoe, rearfoot_wedge: { side: "lateral", value: 3, unit: "mm" } },
            "right",
        );
        const highFlex = await persistedLoftSettings(
            { shoe_size: shoe, arch: "high", flexible_foot: true },
            "left",
        );
        expect(sideCorrection(highFlex.persisted, "left").archHeightMm).toBe(3);
        expect(sideCorrection(highFlex.persisted, "left").apexMoveMm).toBe(4);
        const wideForefoot = await persistedLoftSettings(
            {
                shoe_size: { system: "US_M", size: 7 },
                width: "medium",
                sliders: { forefoot_width_mm: 10 },
            },
            "right",
            7,
        );
        expect(sideCorrection(wideForefoot.persisted, "right").forefootWidthMm).toBe(10);
        for (const saved of [wedgeLeft.persisted, wedgeRight.persisted]) {
            for (const side of ["left", "right"] as const) {
                expect(JSON.parse(JSON.stringify(sideCorrection(saved, side).rearfootWedge))).toEqual({
                    side: "lateral",
                    value: 3,
                    unit: "mm",
                });
                expect(JSON.stringify(sideCorrection(saved, side).rearfootWedge)).not.toContain("degree");
            }
        }
        expect(JSON.parse(JSON.stringify(sideCorrection(wedgeLeft.settings, "left").rearfootWedge))).toEqual({
            side: "lateral",
            value: 3,
            unit: "mm",
        });
        expect(
            JSON.parse(JSON.stringify(sideCorrection(wedgeRight.settings, "right").rearfootWedge)),
        ).toEqual({
            side: "lateral",
            value: 3,
            unit: "mm",
        });

        const cases: GeometryCase[] = [
            {
                label: "default",
                side: "left",
                settings: (await persistedLoftSettings({ shoe_size: shoe }, "left")).settings,
            },
            { label: "low-arch-sink", side: "left", settings: low.settings },
            { label: "high-arch", side: "left", settings: high.settings },
            { label: "wedge-left", side: "left", settings: wedgeLeft.settings },
            { label: "wedge-right", side: "right", settings: wedgeRight.settings },
            { label: "high-flex-left", side: "left", settings: highFlex.settings },
            { label: "wide-forefoot-right", side: "right", settings: wideForefoot.settings },
        ];

        const dir = mkdtempSync(join(tmpdir(), "canonical-export-geometry-"));
        const casesPath = join(dir, "cases.json");
        const reportPath = join(dir, "report.json");
        writeFileSync(
            casesPath,
            JSON.stringify(
                cases.map((item) => ({ label: item.label, side: item.side, settings: item.settings })),
            ),
        );

        execFileSync(process.execPath, ["scripts/bundle-canonical-export-loft.mjs"], {
            cwd: VERTEX_CWD,
            stdio: "inherit",
        });
        execFileSync(
            process.execPath,
            [
                "--experimental-strip-types",
                resolve(HERE, "finalized-mesh-runner.geometry.mjs"),
                casesPath,
                reportPath,
            ],
            { cwd: REPO_ROOT, stdio: "inherit" },
        );
        const report = JSON.parse(readFileSync(reportPath, "utf8")) as GeometryReport;
        expect(report.emptySnapshotMessage).toContain("Design has no saved parameter snapshot");
        expect(report.emptySnapshotMessage).toContain("Refusing to substitute a different mesh");

        const canonical = new Map<string, string>();
        for (const item of cases) {
            canonical.set(item.label, await canonicalExportSha(item.settings, item.side));
        }

        for (const item of cases) {
            const foot = report.cases[item.label];
            expect(foot?.error ?? null).toBeNull();
            expect(foot?.upload).toBeGreaterThan(foot?.solid ?? 0);
            expect(foot?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
            expect(foot?.stamp).toBe(item.side);
            expect(foot?.sha256).toBe(canonical.get(item.label));
        }

        const distinct = new Set(cases.map((item) => report.cases[item.label]?.sha256));
        expect(distinct.size).toBe(cases.length);
        expect(report.cases["low-arch-sink"]?.fingerprint).not.toBe(report.cases.default?.fingerprint);
        expect(report.cases["wedge-left"]?.fingerprint).not.toBe(report.cases["wedge-right"]?.fingerprint);
    }, 900_000);
});
