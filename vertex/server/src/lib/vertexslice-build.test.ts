import { afterEach, describe, expect, test } from "@rstest/core";

import {
    cadOperatorManufacturingIdentity,
    claimProduction,
    MemoryCadProductionStore,
    type CadProductionInsert,
} from "./cad-operator-production.js";
import {
    getVertexSliceBuild,
    parseVertexSliceBuild,
    resetVertexSliceBuildCache,
    UNKNOWN_SLICER_BUILD,
} from "./vertexslice-build.js";

// Kendon 2026-11-24 10:09 PM MT: "make sure cached gcode don't get reloaded".
// A belt G-code sliced by one VertexSlice build must never be reused after the slicer changes.

const BUILD_PRE_52 = "8cac1d54c5e1a12f4693412c32fe40dd9c5682b9279e2b1d38f1225760aca579";
const BUILD_POST_52 = "979e31bdf64b2eab4559717b8cc4e862a030fc35e235be2482c253cb2fd3b782";

function beltInsert(slicerBuild: string): CadProductionInsert {
    const identity = cadOperatorManufacturingIdentity({
        designId: "ad1e0cc5-e221-443c-a477-2488b7f1c536",
        side: "left",
        presetId: "apex-v2-insole-95a",
        useSavedDesignMesh: true,
        material: "apex_core",
        beltAngleDeg: 45,
        layerHeightMm: null,
        printRecipe: { v: 1 },
        settingsJson: { a: 1 },
        stlStorageKey: null,
        slicerBuild,
    });
    return {
        designId: "ad1e0cc5-e221-443c-a477-2488b7f1c536",
        side: "left",
        presetId: "apex-v2-insole-95a",
        idempotencyKey: identity.idempotencyKey,
        settingsFingerprint: identity.fingerprint,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

async function succeed(store: MemoryCadProductionStore, id: string, now: Date) {
    await store.updateIf(id, () => true, {
        status: "succeeded",
        gcodeStorageKey: `gcode/cad-operator/t/c/${id}/left.gcode`,
        updatedAt: now,
        leaseExpiresAt: null,
    });
}

describe("belt G-code cache is keyed by the VertexSlice build", () => {
    afterEach(() => resetVertexSliceBuildCache());

    test("a production from a different slicer build is never reused", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-24T20:00:00.000Z");
        const old = await claimProduction(store, beltInsert(BUILD_PRE_52), now);
        expect(old.run).toBe(true);
        await succeed(store, old.row.id, now);

        const later = new Date("2026-11-25T05:00:00.000Z");
        const fresh = await claimProduction(store, beltInsert(BUILD_POST_52), later);
        expect(fresh.run).toBe(true);
        expect(fresh.row.id).not.toBe(old.row.id);
        expect(fresh.row.gcodeStorageKey).toBeNull();
    });

    test("the same slicer build still reuses its own succeeded production", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-25T05:00:00.000Z");
        const first = await claimProduction(store, beltInsert(BUILD_POST_52), now);
        await succeed(store, first.row.id, now);
        const again = await claimProduction(store, beltInsert(BUILD_POST_52), new Date(now.getTime() + 1000));
        expect(again.run).toBe(false);
        expect(again.row.id).toBe(first.row.id);
    });

    test("the build is part of the fingerprint and the idempotency key", () => {
        const a = beltInsert(BUILD_PRE_52);
        const b = beltInsert(BUILD_POST_52);
        const u = beltInsert(UNKNOWN_SLICER_BUILD);
        expect(a.settingsFingerprint).not.toBe(b.settingsFingerprint);
        expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
        expect(u.idempotencyKey).not.toBe(a.idempotencyKey);
        expect(u.idempotencyKey).not.toBe(b.idempotencyKey);
    });

    test("non-VertexSlice deliverables keep their fingerprint (no slicerBuild)", () => {
        const base = {
            designId: "d",
            side: "left" as const,
            presetId: "vertex-lab-idaho-one-side",
            useSavedDesignMesh: true,
            material: "eva",
            beltAngleDeg: 0,
            layerHeightMm: null,
            printRecipe: null,
            settingsJson: null,
            stlStorageKey: null,
            deliverable: "cnc_gcode" as const,
        };
        expect(cadOperatorManufacturingIdentity(base).fingerprint).toBe(
            cadOperatorManufacturingIdentity({ ...base }).fingerprint,
        );
    });

    test("build is read from the slicer's /health; anything else is unknown (null)", async () => {
        expect(parseVertexSliceBuild({ status: "ok", build: BUILD_POST_52 })).toBe(BUILD_POST_52);
        expect(parseVertexSliceBuild({ status: "ok" })).toBeNull();
        expect(parseVertexSliceBuild({ build: "pending" })).toBeNull();
        expect(parseVertexSliceBuild(null)).toBeNull();

        let calls = 0;
        const ok = (async (url: RequestInfo | URL) => {
            calls += 1;
            expect(String(url)).toBe("https://slicer.example/health");
            return new Response(JSON.stringify({ status: "ok", build: BUILD_POST_52 }), { status: 200 });
        }) as typeof fetch;
        expect(await getVertexSliceBuild({ fetchImpl: ok, nowMs: 0, baseUrl: "https://slicer.example/" })).toBe(
            BUILD_POST_52,
        );
        // Cached for a minute, then re-read so a slicer redeploy is picked up.
        await getVertexSliceBuild({ fetchImpl: ok, nowMs: 30_000, baseUrl: "https://slicer.example" });
        expect(calls).toBe(1);
        await getVertexSliceBuild({ fetchImpl: ok, nowMs: 61_000, baseUrl: "https://slicer.example" });
        expect(calls).toBe(2);

        resetVertexSliceBuildCache();
        const old = (async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as typeof fetch;
        expect(await getVertexSliceBuild({ fetchImpl: old, nowMs: 0, baseUrl: "https://slicer.example" })).toBeNull();
        resetVertexSliceBuildCache();
        const down = (async () => {
            throw new TypeError("ECONNREFUSED");
        }) as typeof fetch;
        expect(await getVertexSliceBuild({ fetchImpl: down, nowMs: 0, baseUrl: "https://slicer.example" })).toBeNull();
    });
});
