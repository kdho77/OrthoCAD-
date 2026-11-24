// Frozen gate T1. Do not edit after the freeze commit.
// A print-cached solid that already carries the composed patient name must be
// reused. applyTextMarkingToPrintSolid / engraveBottomPlanar must not run again.
// A pre-text cache (no guide) still engraves once. No composed text never engraves.

import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import {
    MANUFACTURING_SOLID_GEOMETRY_VERSION,
    type ManufacturingSolidContext,
    manufacturingLoftStats,
    manufacturingSolidFingerprint,
    publishPreviewManufacturingSolid,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    buildProceduralExportSolid,
    resetSampleTopGeometryCache,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { check, ENGRAVE_NAME_A, triangleGeometry, WARM_REUSE_MAX_MS } from "./support";

function context(patch: Partial<ManufacturingSolidContext> = {}): ManufacturingSolidContext {
    return {
        side: "left",
        mirrored: false,
        baseAssetId: "sample-top",
        printLoftEpoch: 4,
        productId: "ApexCore",
        machineId: "printing_solid:apex-v2-insole-95a",
        geometryVersion: MANUFACTURING_SOLID_GEOMETRY_VERSION,
        ...patch,
    };
}

function marking() {
    return { ...defaultTextMarking("bottom"), text: "", addPatientName: true as const };
}

function solid(side: "left" | "right", name: string | null) {
    return {
        side,
        wallStyle: "round" as const,
        deviceType: "functional" as const,
        thicknessMm: 3,
        textMarking: marking(),
        patientDisplayName: name,
    };
}

beforeEach(() => {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
});

describe("T1 print cache is not engraved a second time", () => {
    test("T1-control no composed text does not call apply or engrave", async () => {
        const apply = await import("@/lib/geometry/text-marking/apply");
        const engrave = await import("@/lib/geometry/text-marking/bottom-engrave");
        const applySpy = rs.spyOn(apply, "applyTextMarkingToPrintSolid");
        const engraveSpy = rs.spyOn(engrave, "engraveBottomPlanar");
        try {
            const options = { side: "left" as const, wallStyle: "round" as const, thicknessMm: 3 };
            const ctx = context();
            const geo = triangleGeometry();
            geo.userData = { mark: "plain" };
            rememberManufacturingSolid(manufacturingSolidFingerprint(options, ctx), "left", geo);
            const reused = await buildProceduralExportSolid(options, ctx);
            const applyCalls = applySpy.mock.calls.length;
            const engraveCalls = engraveSpy.mock.calls.length;
            check({
                id: "T1-control",
                rule: "TESTS-1 control: a cache hit with no composed text does not engrave",
                expectOnBase: "pass",
                pass: applyCalls === 0 && engraveCalls === 0 && reused.geometry.userData.mark === "plain",
                measured: `applyTextMarkingToPrintSolid=${applyCalls} engraveBottomPlanar=${engraveCalls}`,
                threshold: "applyTextMarkingToPrintSolid=0 engraveBottomPlanar=0",
            });
            geo.dispose();
            reused.geometry.dispose();
        } finally {
            applySpy.mockRestore();
            engraveSpy.mockRestore();
        }
    });

    test("T1-engraved print-cached composed name is not engraved again on either foot", async () => {
        const apply = await import("@/lib/geometry/text-marking/apply");
        const engrave = await import("@/lib/geometry/text-marking/bottom-engrave");
        const applySpy = rs
            .spyOn(apply, "applyTextMarkingToPrintSolid")
            .mockImplementation(async (host) => host);
        const engraveSpy = rs.spyOn(engrave, "engraveBottomPlanar");
        try {
            const started = performance.now();
            for (const side of ["left", "right"] as const) {
                const options = solid(side, ENGRAVE_NAME_A);
                const ctx = context({ side, mirrored: side === "right" });
                const geo = triangleGeometry();
                geo.userData = {
                    mark: `engraved-${side}`,
                    textGuide: { letters: [ENGRAVE_NAME_A] },
                    bottomOutlineWorld: { sole: true },
                };
                publishPreviewManufacturingSolid(options, ctx, geo);
                const reused = await buildProceduralExportSolid(options, ctx);
                expect(reused.geometry.userData.mark).toBe(`engraved-${side}`);
                expect(reused.geometry.userData.fromManufacturingCache).toBe(true);
                geo.dispose();
                reused.geometry.dispose();
            }
            const elapsedMs = performance.now() - started;
            const applyCalls = applySpy.mock.calls.length;
            const engraveCalls = engraveSpy.mock.calls.length;
            const stats = manufacturingLoftStats();
            const pass =
                applyCalls === 0 &&
                engraveCalls === 0 &&
                stats.built === 0 &&
                stats.reused === 2 &&
                elapsedMs < WARM_REUSE_MAX_MS;
            check({
                id: "T1-engraved",
                rule: "TESTS-1: Print-cached composed name (text empty, addPatientName true) is not engraved again",
                expectOnBase: "fail",
                pass,
                measured: `apply=${applyCalls} engrave=${engraveCalls} built=${stats.built} reused=${stats.reused} elapsedMs=${elapsedMs.toFixed(1)}`,
                threshold: `apply=0 engrave=0 built=0 reused=2 elapsedMs<${WARM_REUSE_MAX_MS}`,
            });
        } finally {
            applySpy.mockRestore();
            engraveSpy.mockRestore();
        }
    });

    test("T1-pretext a pre-text cache still engraves once", async () => {
        const apply = await import("@/lib/geometry/text-marking/apply");
        const engrave = await import("@/lib/geometry/text-marking/bottom-engrave");
        const applySpy = rs
            .spyOn(apply, "applyTextMarkingToPrintSolid")
            .mockImplementation(async (host) => host);
        const engraveSpy = rs.spyOn(engrave, "engraveBottomPlanar");
        try {
            const options = solid("left", ENGRAVE_NAME_A);
            const ctx = context();
            const geo = triangleGeometry();
            geo.userData = { mark: "pre-text" };
            rememberManufacturingSolid(manufacturingSolidFingerprint(options, ctx), "left", geo);
            const out = await buildProceduralExportSolid(options, ctx);
            const applyCalls = applySpy.mock.calls.length;
            const engraveCalls = engraveSpy.mock.calls.length;
            check({
                id: "T1-pretext",
                rule: "TESTS-1: a cached pre-text loft still runs the bottom engrave once",
                expectOnBase: "pass",
                pass:
                    applyCalls === 1 &&
                    engraveCalls === 0 &&
                    out.geometry.userData.fromManufacturingCache === true &&
                    out.geometry.userData.mark === "pre-text",
                measured: `apply=${applyCalls} engrave=${engraveCalls} fromCache=${String(out.geometry.userData.fromManufacturingCache)}`,
                threshold: "apply=1 engrave=0 fromCache=true (engrave runs inside the one apply call)",
            });
            geo.dispose();
            out.geometry.dispose();
        } finally {
            applySpy.mockRestore();
            engraveSpy.mockRestore();
        }
    });
});
