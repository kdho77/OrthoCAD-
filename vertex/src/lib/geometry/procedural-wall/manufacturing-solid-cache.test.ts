// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { BufferGeometry } from "three";
import { baseModifierField, baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { elementsForSurface } from "@/lib/geometry/element-assets/display-mesh";
import { resolveLiveBottomPattern } from "@/lib/geometry/procedural-wall/live-bottom-pattern";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    resetSampleTopGeometryCache,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { resolveViewerWallStyle } from "@/lib/geometry/procedural-wall/viewer-wall-flag";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { getDesignTrimline } from "@/lib/geometry/trimline";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
import {
    invalidateProceduralPrintLoftForDesignStep,
    usePreviewLoftStatusStore,
} from "@/stores/preview-loft-status-store";
import type { Side } from "@/types";
import {
    MANUFACTURING_SOLID_GEOMETRY_VERSION,
    MANUFACTURING_STL_PLACEMENT_VERSION,
    type ManufacturingSolidContext,
    manufacturingLoftStats,
    manufacturingSolidFingerprint,
    manufacturingSolidIdentity,
    peekManufacturingSolid,
    publishPreviewManufacturingSolid,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
} from "./manufacturing-solid-cache";

function context(patch: Partial<ManufacturingSolidContext> = {}): ManufacturingSolidContext {
    return {
        side: "left",
        mirrored: false,
        baseAssetId: "sample-top",
        printLoftEpoch: 4,
        productId: "ApexCore",
        machineId: "printing_solid:apex-v2-insole-95a",
        geometryVersion: MANUFACTURING_SOLID_GEOMETRY_VERSION,
        placementVersion: MANUFACTURING_STL_PLACEMENT_VERSION,
        ...patch,
    };
}

function options(patch: Record<string, unknown> = {}) {
    return {
        side: "left" as const,
        wallStyle: "round" as const,
        deviceType: "functional" as const,
        thicknessMm: 3,
        scanPattern: "full_contact" as const,
        composedTop: true,
        footprintScale: 1,
        corrections: { heelCupHeightMm: 0 },
        bottomPattern: [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 1, z: 0 },
            { x: 20, y: 0, z: 0 },
        ],
        trimline: {
            points: [
                { x: 0, y: 0, z: 0 },
                { x: 30, y: -10, z: 0 },
                { x: 60, y: 0, z: 0 },
                { x: 30, y: 10, z: 0 },
            ],
        },
        lateralFlange: { heightMm: 0, lengthMm: 40, angleDeg: 10 },
        sourceField: {
            side: "left" as const,
            lengthMm: 270,
            widthMm: 90,
            thicknessMm: 3,
            corrections: { heelCupHeightMm: 0 },
            elements: [],
            includeElements: true,
            includeSkives: false,
        },
        ...patch,
    };
}

beforeEach(() => {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    usePreviewLoftStatusStore.getState().reset();
});

describe("manufacturing solid fingerprint", () => {
    test("trimline, pattern, walls, corrections, side, product, machine, version, and epoch all miss", () => {
        const base = manufacturingSolidFingerprint(options(), context());
        const changed: Array<[string, string]> = [
            [
                "trimline",
                manufacturingSolidFingerprint(
                    options({ trimline: { points: [{ x: 1, y: 1, z: 0 }] } }),
                    context(),
                ),
            ],
            [
                "pattern",
                manufacturingSolidFingerprint(
                    options({
                        bottomPattern: [
                            { x: 0, y: 5, z: 0 },
                            { x: 10, y: 1, z: 0 },
                            { x: 20, y: 0, z: 0 },
                        ],
                    }),
                    context(),
                ),
            ],
            ["walls", manufacturingSolidFingerprint(options({ wallStyle: "straight" }), context())],
            [
                "corrections",
                manufacturingSolidFingerprint(options({ corrections: { heelCupHeightMm: 2 } }), context()),
            ],
            ["side", manufacturingSolidFingerprint(options({ side: "right" }), context({ side: "right" }))],
            ["product", manufacturingSolidFingerprint(options(), context({ productId: "ApexLight" }))],
            [
                "machine",
                manufacturingSolidFingerprint(
                    options(),
                    context({ machineId: "printing_solid:other-profile" }),
                ),
            ],
            ["geometry version", manufacturingSolidFingerprint(options(), context({ geometryVersion: 3 }))],
            ["printLoftEpoch", manufacturingSolidFingerprint(options(), context({ printLoftEpoch: 5 }))],
            ["beltPrint", manufacturingSolidFingerprint(options({ beltPrint: true }), context())],
            [
                "placement version",
                manufacturingSolidFingerprint(
                    options({ beltPrint: true }),
                    context({ placementVersion: 99 }),
                ),
            ],
        ];
        for (const [label, next] of changed) {
            expect(next, label).not.toBe(base);
        }
    });

    test("a committed trimline on the field matches a preview field that leaves trimline empty", () => {
        const curve = options().trimline;
        const field = options().sourceField;
        const preview = options({
            trimline: curve,
            sourceField: { ...field, trimline: null },
        });
        const exported = options({
            trimline: curve,
            sourceField: { ...field, trimline: curve },
        });
        expect(manufacturingSolidFingerprint(preview, context())).toBe(
            manufacturingSolidFingerprint(exported, context()),
        );
        const draft = { points: [{ x: 4, y: 4, z: 0 }] };
        const drifted = options({
            trimline: draft,
            sourceField: { ...field, trimline: curve },
        });
        expect(manufacturingSolidFingerprint(drifted, context())).not.toBe(
            manufacturingSolidFingerprint(preview, context()),
        );
    });

    test("patient name, addPatientName, and additional text each change the fingerprint", () => {
        const marking = { ...defaultTextMarking("bottom"), text: "", addPatientName: true as const };
        const base = manufacturingSolidFingerprint(
            options({ textMarking: marking, patientDisplayName: "PATIENT A" }),
            context(),
        );
        expect(
            manufacturingSolidFingerprint(
                options({ textMarking: marking, patientDisplayName: "PATIENT B" }),
                context(),
            ),
        ).not.toBe(base);
        expect(
            manufacturingSolidFingerprint(
                options({
                    textMarking: { ...marking, addPatientName: false },
                    patientDisplayName: "PATIENT A",
                }),
                context(),
            ),
        ).not.toBe(base);
        expect(
            manufacturingSolidFingerprint(
                options({
                    textMarking: { ...marking, text: "CLINIC" },
                    patientDisplayName: "PATIENT A",
                }),
                context(),
            ),
        ).not.toBe(base);
        expect(
            manufacturingSolidFingerprint(
                options({ textMarking: marking, patientDisplayName: "PATIENT A", side: "right" }),
                context({ side: "right" }),
            ),
        ).not.toBe(base);
        const noName = manufacturingSolidFingerprint(options({ textMarking: marking }), context());
        expect(noName).toBe(manufacturingSolidFingerprint(options(), context()));
        expect(
            manufacturingSolidFingerprint(
                options({ textMarking: { ...marking, addPatientName: false } }),
                context(),
            ),
        ).not.toBe(noName);
    });

    test("stock preview options and export options share one fingerprint", () => {
        const design = useDesignStore.getState().design;
        const side: Side = "left";
        const thickness = design.paired?.leftThicknessMm ?? design.thicknessMm;
        const previewField = baseModifierField(design, side, thickness);
        previewField.elements = elementsForSurface(previewField.elements ?? [], true);
        const viewer = useDesignStore.getState().viewer;
        const pattern = resolveLiveBottomPattern({
            draft: null,
            stored: useBottomPatternStore.getState().getPattern(side),
        });
        const trimline = getDesignTrimline(design, side);
        const previewOptions = printSolidOptions({
            design,
            side,
            field: previewField,
            viewer: {
                wallStyle: resolveViewerWallStyle(viewer.wallStyle),
                deviceType: viewer.deviceType ?? "functional",
                lateralFlangeHeightMm: viewer.lateralFlangeHeightMm ?? 0,
                lateralFlangeLengthMm: viewer.lateralFlangeLengthMm ?? 40,
                lateralFlangeAngleDeg: viewer.lateralFlangeAngleDeg ?? 10,
            },
            trimline,
            bottomPattern: pattern,
        });
        const exportOptions = {
            ...printSolidOptions({
                design,
                side,
                field: baseModifierFieldAuthoritative(design, side, thickness),
                viewer,
                trimline,
                bottomPattern: pattern,
            }),
            mirrored: Boolean(design.paired?.leftBase?.mirrored),
        };
        const ctx = context({
            side,
            mirrored: Boolean(design.paired?.leftBase?.mirrored),
            baseAssetId: design.paired?.leftBase?.assetId ?? "",
            printLoftEpoch: 0,
        });
        const previewId = manufacturingSolidIdentity(previewOptions, ctx);
        const exportId = manufacturingSolidIdentity(exportOptions, ctx);
        expect(exportId).toEqual(previewId);
    });
});

describe("manufacturing solid reuse", () => {
    test("left and right slots do not collide, and a warm export does not loft", async () => {
        const leftOptions = options();
        const rightOptions = options({ side: "right" });
        const leftCtx = context();
        const rightCtx = context({ side: "right", mirrored: true });
        const leftFp = manufacturingSolidFingerprint(leftOptions, leftCtx);
        const rightFp = manufacturingSolidFingerprint(rightOptions, rightCtx);
        const leftGeo = new BufferGeometry();
        const rightGeo = new BufferGeometry();
        leftGeo.userData = { mark: "L" };
        rightGeo.userData = { mark: "R" };
        rememberManufacturingSolid(leftFp, "left", leftGeo);
        rememberManufacturingSolid(rightFp, "right", rightGeo);
        expect(peekManufacturingSolid(leftFp, "right")).toBeNull();
        expect(peekManufacturingSolid(rightFp, "left")).toBeNull();
        expect(peekManufacturingSolid(leftFp, "left")?.userData.mark).toBe("L");
        expect(peekManufacturingSolid(rightFp, "right")?.userData.mark).toBe("R");

        const fetchSpy = rs.spyOn(globalThis, "fetch");
        const started = performance.now();
        const reusedLeft = await buildProceduralExportSolid(leftOptions, leftCtx);
        const reusedRight = await buildProceduralExportSolid(rightOptions, rightCtx);
        const warmMs = performance.now() - started;
        expect(reusedLeft.geometry.userData.mark).toBe("L");
        expect(reusedLeft.geometry.userData.fromManufacturingCache).toBe(true);
        expect(reusedRight.geometry.userData.mark).toBe("R");
        expect(fetchSpy).not.toHaveBeenCalled();
        const counts = manufacturingLoftStats();
        expect(counts.built).toBe(0);
        expect(counts.reused).toBe(2);
        expect(counts.reusedBySide).toEqual({ left: 1, right: 1 });
        expect(counts.builtBySide).toEqual({ left: 0, right: 0 });
        expect(warmMs).toBeLessThan(500);
        expect(counts.lastReuseMs).toBeLessThan(500);
        fetchSpy.mockRestore();
        reusedLeft.geometry.dispose();
        reusedRight.geometry.dispose();
        leftGeo.dispose();
        rightGeo.dispose();
    });

    test("leaving Print bumps printLoftEpoch and drops the cached solid", () => {
        const fp = manufacturingSolidFingerprint(options(), context({ printLoftEpoch: 2 }));
        rememberManufacturingSolid(fp, "left", new BufferGeometry());
        usePreviewLoftStatusStore.setState({
            phaseBySide: { left: "ready", right: "ready" },
            printLoftEpoch: 2,
        });
        invalidateProceduralPrintLoftForDesignStep();
        expect(usePreviewLoftStatusStore.getState().printLoftEpoch).toBe(3);
        expect(usePreviewLoftStatusStore.getState().phaseBySide).toEqual({ left: "idle", right: "idle" });
        expect(peekManufacturingSolid(fp, "left")).toBeNull();
        expect(manufacturingSolidFingerprint(options(), context({ printLoftEpoch: 3 }))).not.toBe(fp);
    });

    test("a print-cached engraved name is not engraved again, including the default patient row", async () => {
        const marking = { ...defaultTextMarking("bottom"), text: "", addPatientName: true as const };
        const apply = await import("@/lib/geometry/text-marking/apply");
        const engrave = await import("@/lib/geometry/text-marking/bottom-engrave");
        const applySpy = rs.spyOn(apply, "applyTextMarkingToPrintSolid");
        const engraveSpy = rs.spyOn(engrave, "engraveBottomPlanar");
        try {
            for (const side of ["left", "right"] as const) {
                const solid = options({
                    side,
                    textMarking: marking,
                    patientDisplayName: "PATIENT A",
                });
                const ctx = context({ side, mirrored: side === "right" });
                const geo = new BufferGeometry();
                geo.userData = { textGuide: { letters: ["PATIENT A"] }, mark: `engraved-${side}` };
                publishPreviewManufacturingSolid(solid, ctx, geo);
                const started = performance.now();
                const reused = await buildProceduralExportSolid(solid, ctx);
                const warmMs = performance.now() - started;
                expect(reused.geometry.userData.mark).toBe(`engraved-${side}`);
                expect(reused.geometry.userData.fromManufacturingCache).toBe(true);
                expect(warmMs).toBeLessThan(500);
                geo.dispose();
                reused.geometry.dispose();
            }
            expect(applySpy).not.toHaveBeenCalled();
            expect(engraveSpy).not.toHaveBeenCalled();
            const counts = manufacturingLoftStats();
            expect(counts.built).toBe(0);
            expect(counts.reused).toBe(2);
            expect(counts.lastReuseMs).toBeLessThan(500);
        } finally {
            applySpy.mockRestore();
            engraveSpy.mockRestore();
        }
    });

    test("changing the patient name misses the engraved solid and starts a fresh build", async () => {
        const marking = { ...defaultTextMarking("bottom"), text: "", addPatientName: true as const };
        const engraved = options({ textMarking: marking, patientDisplayName: "PATIENT A" });
        const ctx = context();
        const geo = new BufferGeometry();
        geo.userData = { textGuide: { letters: ["PATIENT A"] }, mark: "old-name" };
        publishPreviewManufacturingSolid(engraved, ctx, geo);
        const renamed = options({ textMarking: marking, patientDisplayName: "PATIENT B" });
        const fetchSpy = rs.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fresh build"));
        try {
            await expect(buildProceduralExportSolid(renamed, ctx)).rejects.toThrow();
            expect(manufacturingLoftStats().reused).toBe(0);
            expect(manufacturingLoftStats().built).toBe(1);
            expect(
                peekManufacturingSolid(manufacturingSolidFingerprint(engraved, ctx), "left")?.userData.mark,
            ).toBe("old-name");
            expect(peekManufacturingSolid(manufacturingSolidFingerprint(renamed, ctx), "left")).toBeNull();
        } finally {
            fetchSpy.mockRestore();
            geo.dispose();
        }
    });

    test("a pre-text cache still engraves once when the composed name is active", async () => {
        const marking = { ...defaultTextMarking("bottom"), text: "", addPatientName: true as const };
        const solid = options({ textMarking: marking, patientDisplayName: "PATIENT A" });
        const ctx = context();
        const geo = new BufferGeometry();
        geo.userData = { mark: "pre-text" };
        rememberManufacturingSolid(manufacturingSolidFingerprint(solid, ctx), "left", geo);
        const apply = await import("@/lib/geometry/text-marking/apply");
        const applySpy = rs
            .spyOn(apply, "applyTextMarkingToPrintSolid")
            .mockImplementation(async (host) => host);
        try {
            const out = await buildProceduralExportSolid(solid, ctx);
            expect(applySpy).toHaveBeenCalledTimes(1);
            expect(out.geometry.userData.fromManufacturingCache).toBe(true);
            expect(out.geometry.userData.mark).toBe("pre-text");
            out.geometry.dispose();
        } finally {
            applySpy.mockRestore();
            geo.dispose();
        }
    });

    test("beltPrint and placement version are in the identity", () => {
        const plain = manufacturingSolidIdentity(options(), context());
        const belt = manufacturingSolidIdentity(options({ beltPrint: true }), context());
        expect(plain.beltPrint).toBe(false);
        expect(belt.beltPrint).toBe(true);
        expect(belt.placementVersion).toBe(MANUFACTURING_STL_PLACEMENT_VERSION);
        expect(manufacturingSolidFingerprint(options({ beltPrint: true }), context())).not.toBe(
            manufacturingSolidFingerprint(options(), context()),
        );
        expect(
            manufacturingSolidFingerprint(options({ beltPrint: true }), context({ placementVersion: 1 })),
        ).not.toBe(manufacturingSolidFingerprint(options({ beltPrint: true }), context()));
    });

    test("a pre-#52 engraved solid is not reused for a belt export", async () => {
        const marking = { ...defaultTextMarking("bottom"), text: "JABBOUR", addPatientName: false as const };
        resetSampleTopGeometryCache();
        resetManufacturingSolidCache();
        const belt = options({ beltPrint: true, textMarking: marking });
        const ctx = context();
        const geo = new BufferGeometry();
        geo.userData = { textGuide: { letters: ["JABBOUR"] }, mark: "pre52", beltPrint: false };
        rememberManufacturingSolid(manufacturingSolidFingerprint(belt, ctx), "left", geo);
        const fetchSpy = rs.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fresh loft"));
        try {
            await expect(buildProceduralExportSolid(belt, ctx)).rejects.toThrow(/fresh loft/);
            expect(manufacturingLoftStats().reused).toBe(0);
            expect(manufacturingLoftStats().built).toBe(1);
        } finally {
            fetchSpy.mockRestore();
            geo.dispose();
        }
    });

    test("publishing the preview solid is what a later export reuses", () => {
        const solid = options();
        const ctx = context();
        const geo = new BufferGeometry();
        geo.userData = { mark: "preview" };
        publishPreviewManufacturingSolid(solid, ctx, geo);
        expect(manufacturingLoftStats().published).toBe(1);
        expect(peekManufacturingSolid(manufacturingSolidFingerprint(solid, ctx), "left")?.userData.mark).toBe(
            "preview",
        );
        expect(peekManufacturingSolid(manufacturingSolidFingerprint(solid, ctx), "right")).toBeNull();
        geo.dispose();
    });
});
