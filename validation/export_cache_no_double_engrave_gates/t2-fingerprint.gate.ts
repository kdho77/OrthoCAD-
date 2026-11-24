// Frozen gate T2. Do not edit after the freeze commit.
// Patient name, the add-patient-name toggle, and additional text each change
// manufacturingSolidFingerprint and start a fresh build. An empty default row
// with no patient name stays aligned with a design that never set text marking.
// Turning the checkbox off still misses.

import { beforeEach, describe, rs, test } from "@rstest/core";
import {
    MANUFACTURING_SOLID_GEOMETRY_VERSION,
    type ManufacturingSolidContext,
    manufacturingLoftStats,
    manufacturingSolidFingerprint,
    publishPreviewManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    buildProceduralExportSolid,
    resetSampleTopGeometryCache,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { check, ENGRAVE_NAME_A, ENGRAVE_NAME_B, triangleGeometry } from "./support";

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

function marking(patch: Record<string, unknown> = {}) {
    return { ...defaultTextMarking("bottom"), text: "", addPatientName: true as const, ...patch };
}

function options(patch: Record<string, unknown> = {}) {
    return {
        side: "left" as const,
        wallStyle: "round" as const,
        deviceType: "functional" as const,
        thicknessMm: 3,
        corrections: { heelCupHeightMm: 0 },
        ...patch,
    };
}

function fp(patch: Record<string, unknown> = {}, ctxPatch: Partial<ManufacturingSolidContext> = {}) {
    return manufacturingSolidFingerprint(options(patch), context(ctxPatch));
}

/** A cache hit must not spend a manifold pass. The assertion is built vs reused. */
async function withStubbedEngrave<T>(run: () => Promise<T>): Promise<T> {
    const apply = await import("@/lib/geometry/text-marking/apply");
    const spy = rs.spyOn(apply, "applyTextMarkingToPrintSolid").mockImplementation(async (host) => host);
    try {
        return await run();
    } finally {
        spy.mockRestore();
    }
}

beforeEach(() => {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
});

describe("T2 manufacturing fingerprint includes the composed engraving", () => {
    test("T2-name patient name changes the fingerprint", () => {
        const base = fp({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_A });
        const next = fp({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_B });
        check({
            id: "T2-name",
            rule: "TESTS-2 / MUST-MATCH: changing the patient name changes manufacturingSolidFingerprint",
            expectOnBase: "fail",
            pass: base !== next,
            measured: `equal=${base === next} a=${base.slice(0, 12)} b=${next.slice(0, 12)}`,
            threshold: "fingerprints differ",
        });
    });

    test("T2-toggle addPatientName changes the fingerprint", () => {
        const base = fp({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_A });
        const next = fp({
            textMarking: marking({ addPatientName: false }),
            patientDisplayName: ENGRAVE_NAME_A,
        });
        check({
            id: "T2-toggle",
            rule: "TESTS-2: the addPatientName toggle changes manufacturingSolidFingerprint",
            expectOnBase: "fail",
            pass: base !== next,
            measured: `equal=${base === next}`,
            threshold: "fingerprints differ",
        });
    });

    test("T2-extra additional text changes the fingerprint", () => {
        const base = fp({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_A });
        const next = fp({
            textMarking: marking({ text: "CLINIC" }),
            patientDisplayName: ENGRAVE_NAME_A,
        });
        check({
            id: "T2-extra",
            rule: "TESTS-2 / MUST-MATCH: additional text changes manufacturingSolidFingerprint",
            expectOnBase: "pass",
            pass: base !== next,
            measured: `equal=${base === next}`,
            threshold: "fingerprints differ",
        });
    });

    test("T2-lr left and right additional lines change the fingerprint", () => {
        const row = marking({
            differentOnLR: true,
            text: "",
            textLeft: "LEFTFOOT",
            textRight: "RIGHTFOOT",
            addPatientName: false,
        });
        const left = fp({ textMarking: row, side: "left" }, { side: "left" });
        const right = fp({ textMarking: row, side: "right" }, { side: "left" });
        check({
            id: "T2-lr",
            rule: "TESTS-2: per-foot additional text changes the fingerprint when the context side is held fixed",
            expectOnBase: "fail",
            pass: left !== right,
            measured: `equal=${left === right}`,
            threshold: "fingerprints differ",
        });
    });

    test("T2-param a design parameter still changes the fingerprint", () => {
        const base = fp({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_A });
        const next = fp({
            textMarking: marking(),
            patientDisplayName: ENGRAVE_NAME_A,
            corrections: { heelCupHeightMm: 2 },
        });
        check({
            id: "T2-param",
            rule: "MUST-MATCH: a design parameter (heel cup height) changes manufacturingSolidFingerprint",
            expectOnBase: "pass",
            pass: base !== next,
            measured: `equal=${base === next}`,
            threshold: "fingerprints differ",
        });
    });

    test("T2-empty default row with no name matches no text marking; checkbox off misses", () => {
        const none = fp();
        const emptyDefault = fp({ textMarking: marking() });
        const checkboxOff = fp({ textMarking: marking({ addPatientName: false }) });
        const aligned = emptyDefault === none;
        const offMisses = checkboxOff !== none;
        check({
            id: "T2-empty",
            rule: "Empty default engraving key stays aligned with no text marking; checkbox off misses",
            expectOnBase: "fail",
            pass: aligned && offMisses,
            measured: `aligned=${aligned} checkboxOffMisses=${offMisses}`,
            threshold: "aligned=true checkboxOffMisses=true",
        });
    });

    test("T2-fresh-name a new patient name misses the cache and starts a build", async () => {
        const engraved = options({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_A });
        const ctx = context();
        const geo = triangleGeometry();
        geo.userData = { textGuide: { letters: [ENGRAVE_NAME_A] }, mark: "old-name" };
        publishPreviewManufacturingSolid(engraved, ctx, geo);
        const renamed = options({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_B });
        const fetchSpy = rs.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fresh build"));
        let rejected = false;
        try {
            await withStubbedEngrave(() => buildProceduralExportSolid(renamed, ctx));
        } catch {
            rejected = true;
        } finally {
            fetchSpy.mockRestore();
        }
        const stats = manufacturingLoftStats();
        check({
            id: "T2-fresh-name",
            rule: "TESTS-2: changing the patient name forces a fresh build",
            expectOnBase: "fail",
            pass: rejected && stats.built === 1 && stats.reused === 0,
            measured: `rejected=${rejected} built=${stats.built} reused=${stats.reused}`,
            threshold: "rejected=true built=1 reused=0",
        });
        geo.dispose();
    });

    test("T2-fresh-extra additional text forces a fresh build", async () => {
        const engraved = options({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_A });
        const ctx = context();
        const geo = triangleGeometry();
        geo.userData = { textGuide: { letters: [ENGRAVE_NAME_A] }, mark: "old-text" };
        publishPreviewManufacturingSolid(engraved, ctx, geo);
        const extra = options({
            textMarking: marking({ text: "CLINIC" }),
            patientDisplayName: ENGRAVE_NAME_A,
        });
        const fetchSpy = rs.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fresh build"));
        let rejected = false;
        try {
            await withStubbedEngrave(() => buildProceduralExportSolid(extra, ctx));
        } catch {
            rejected = true;
        } finally {
            fetchSpy.mockRestore();
        }
        const stats = manufacturingLoftStats();
        check({
            id: "T2-fresh-extra",
            rule: "TESTS-2: additional text forces a fresh build",
            expectOnBase: "pass",
            pass: rejected && stats.built === 1 && stats.reused === 0,
            measured: `rejected=${rejected} built=${stats.built} reused=${stats.reused}`,
            threshold: "rejected=true built=1 reused=0",
        });
        geo.dispose();
    });

    test("T2-fresh-toggle clearing addPatientName forces a fresh build", async () => {
        const engraved = options({ textMarking: marking(), patientDisplayName: ENGRAVE_NAME_A });
        const ctx = context();
        const geo = triangleGeometry();
        geo.userData = { textGuide: { letters: [ENGRAVE_NAME_A] }, mark: "old-toggle" };
        publishPreviewManufacturingSolid(engraved, ctx, geo);
        const off = options({
            textMarking: marking({ addPatientName: false }),
            patientDisplayName: ENGRAVE_NAME_A,
        });
        const fetchSpy = rs.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fresh build"));
        let rejected = false;
        try {
            await withStubbedEngrave(() => buildProceduralExportSolid(off, ctx));
        } catch {
            rejected = true;
        } finally {
            fetchSpy.mockRestore();
        }
        const stats = manufacturingLoftStats();
        check({
            id: "T2-fresh-toggle",
            rule: "TESTS-2: the addPatientName toggle forces a fresh build",
            expectOnBase: "fail",
            pass: rejected && stats.built === 1 && stats.reused === 0,
            measured: `rejected=${rejected} built=${stats.built} reused=${stats.reused}`,
            threshold: "rejected=true built=1 reused=0",
        });
        geo.dispose();
    });
});
