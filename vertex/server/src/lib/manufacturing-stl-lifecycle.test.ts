// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, test } from "@rstest/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrintRecipeV1 } from "../../../shared/print-recipe/print-recipe.js";
import { runSessionGenerateSolid, type SessionManufacturingIo } from "../routers/manufacturing-session.js";
import { executeCadOperatorProduction, MemoryCadProductionStore } from "./cad-operator-production.js";
import { downloadManufacturingStl } from "./manufacturing-stl-download.js";
import {
    cleanupManufacturingTempObjects,
    deleteCadOperatorGcodeAfterVoAttach,
    discardManufacturingTempStl,
    listStoredManufacturingFiles,
    MANUFACTURING_SWEEP_MAX_AGE_HOURS,
    storedManufacturingListPlan,
} from "./manufacturing-stl-lifecycle.js";
import {
    buildManufacturingTempStlKey,
    MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC,
    signedDownloadUrl,
} from "./storage.js";

const NOW = Date.parse("2026-11-26T00:00:00.000Z");
const USER = "00000000-0000-4000-8000-0000000000aa";
const FIXTURE_GCODE = gunzipSync(
    readFileSync(resolve(__dirname, "../../../../tests/fixtures/handedness/true_left_toe_first.gcode.gz")),
).toString("utf8");

const recipe: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
    profileId: "apex-v2-insole-95a",
    defaultHardness: "Hard",
    zones: [],
};

interface Stored {
    key: string;
    createdAt?: string;
    bytes?: Uint8Array;
}

function hoursBefore(hours: number): string {
    return new Date(NOW - hours * 60 * 60 * 1000).toISOString();
}

function memoryBucket(initial: Stored[]) {
    const objects = initial.map((object) => ({ ...object }));
    const updates: Array<{ table: string; values: unknown }> = [];
    const client = {
        from(table: string) {
            return {
                update(values: unknown) {
                    updates.push({ table, values });
                    return { eq: async () => ({ error: null }) };
                },
            };
        },
        storage: {
            from() {
                return {
                    upload: async (key: string, data: Uint8Array) => {
                        objects.push({ key, createdAt: new Date(NOW).toISOString(), bytes: data });
                        return { error: null };
                    },
                    remove: async (keys: string[]) => {
                        for (const key of keys) {
                            const index = objects.findIndex((object) => object.key === key);
                            if (index >= 0) objects.splice(index, 1);
                        }
                        return { error: null };
                    },
                    createSignedUrl: async (key: string, expiresInSec: number) => ({
                        data: { signedUrl: `https://files.example.test/${key}?exp=${expiresInSec}` },
                        error: null,
                    }),
                    list: async (prefix: string, opts?: { limit?: number; offset?: number }) => {
                        const normalized = prefix.replace(/\/$/, "");
                        const children = new Map<
                            string,
                            { name: string; id: string | null; created_at?: string }
                        >();
                        for (const object of objects) {
                            if (!object.key.startsWith(`${normalized}/`)) continue;
                            const rest = object.key.slice(normalized.length + 1);
                            const [name, ...more] = rest.split("/");
                            if (!name) continue;
                            if (more.length > 0) {
                                if (!children.has(name)) children.set(name, { name, id: null });
                                continue;
                            }
                            children.set(name, {
                                name,
                                id: object.key,
                                ...(object.createdAt ? { created_at: object.createdAt } : {}),
                            });
                        }
                        const all = [...children.values()];
                        const offset = opts?.offset ?? 0;
                        const limit = opts?.limit ?? 100;
                        return { data: all.slice(offset, offset + limit), error: null };
                    },
                };
            },
        },
    };
    return { objects, updates, client: client as unknown as SupabaseClient };
}

describe("manufacturing files are not kept at rest", () => {
    test("a successful job leaves no archive object and never sets exports.sourceStlPath", async () => {
        const tempKey = buildManufacturingTempStlKey(USER, 1, "55555555-5555-4555-8555-555555555555");
        const archiveKey = `manufacturing-archive/${USER}/44444444-4444-4444-8444-444444444444.stl`;
        const bucket = memoryBucket([
            { key: tempKey, createdAt: hoursBefore(1), bytes: Uint8Array.from([1, 2, 3]) },
            { key: archiveKey, createdAt: hoursBefore(1), bytes: Uint8Array.from([9]) },
        ]);
        const store = new MemoryCadProductionStore();
        const now = new Date(NOW);
        const row = await store.insert({
            id: "33333333-3333-4333-8333-333333333333",
            designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            side: "left",
            presetId: "apex-v2-insole-95a",
            status: "pending",
            idempotencyKey: "cadop:v1:lifecycle:left",
            settingsFingerprint: "fp",
            gcodeStorageKey: null,
            error: null,
            createdAt: now,
            updatedAt: now,
            leaseExpiresAt: new Date(NOW + 60_000),
            chargedAt: null,
            exportId: null,
            method: "printing_solid",
            beltAngleDeg: 45,
            layerHeightMm: null,
            material: "apex_core",
        });
        let uploaded = "";
        const gcodeKey = "gcode/cad-operator/11111111-1111-4111-8111-111111111111/cred/design/left.gcode";
        await executeCadOperatorProduction({
            row,
            store,
            now: () => now,
            materialize: async () => ({ stlStorageKey: tempKey, meshFingerprint: "mesh" }),
            slice: async () => ({ gcode: FIXTURE_GCODE, jobId: "job-1" }),
            uploadGcode: async (gcode) => {
                uploaded = gcode;
                bucket.objects.push({
                    key: gcodeKey,
                    createdAt: new Date(NOW).toISOString(),
                    bytes: Buffer.from(gcode, "utf8"),
                });
                return { storageKey: gcodeKey };
            },
            charge: async () => ({
                exportId: "44444444-4444-4444-8444-444444444444",
                balance: 6,
                alreadyCharged: false,
            }),
            deleteTemp: async (key) => {
                await discardManufacturingTempStl(bucket.client, key);
            },
        });

        expect(uploaded).toBe(FIXTURE_GCODE);
        expect(bucket.objects.some((object) => object.key === tempKey)).toBe(false);
        expect(
            bucket.objects
                .filter((object) => object.key.startsWith("manufacturing-archive/"))
                .map((object) => object.key),
        ).toEqual([archiveKey]);
        expect(bucket.updates.some((update) => update.table === "exports")).toBe(false);
        expect(JSON.stringify(bucket.updates)).not.toContain("sourceStlPath");
        const saved = await store.findById(row.id);
        expect(saved?.status).toBe("succeeded");
        expect(saved?.gcodeStorageKey).toBe(gcodeKey);
    });

    test("temp STL is deleted after slice success and failure", async () => {
        const tempKey = buildManufacturingTempStlKey(USER, 2, "66666666-6666-4666-8666-666666666666");
        const deleted: string[] = [];
        const io = sessionIo(FIXTURE_GCODE, deleted);
        const result = await runSessionGenerateSolid({
            userId: USER,
            ip: null,
            input: {
                side: "left",
                presetId: "apex-v2-insole-95a",
                stlStorageKey: tempKey,
                outputType: "gcode",
                beltAngleDeg: 45,
                printRecipe: recipe,
                material: "apex_core",
            },
            io,
        });
        expect(result.gcodeStorageKey?.startsWith("gcode/")).toBe(true);
        expect(deleted).toEqual([tempKey]);

        const failedKey = buildManufacturingTempStlKey(USER, 3, "77777777-7777-4777-8777-777777777777");
        const failedDeletes: string[] = [];
        const failing = sessionIo(FIXTURE_GCODE, failedDeletes);
        failing.sliceWithVertexSlice = async () => {
            throw new Error("slice failed");
        };
        await expect(
            runSessionGenerateSolid({
                userId: USER,
                ip: null,
                input: {
                    side: "left",
                    presetId: "apex-v2-insole-95a",
                    stlStorageKey: failedKey,
                    outputType: "gcode",
                    beltAngleDeg: 45,
                    printRecipe: recipe,
                    material: "apex_core",
                },
                io: failing,
            }),
        ).rejects.toThrow("slice failed");
        expect(failedDeletes).toEqual([failedKey]);
    });

    test("cad-operator G-code is deleted after VO attach, and the sweep removes gcode and temps older than 24h", async () => {
        const freshTemp = `manufacturing-temp/${USER}/fresh.stl`;
        const staleTemp = `manufacturing-temp/cad-operator/11111111-1111-4111-8111-111111111111/cred/stale.stl`;
        const freshGcode = `gcode/${USER}/fresh.gcode`;
        const staleGcode = "gcode/cad-operator/11111111-1111-4111-8111-111111111111/cred/design/left.gcode";
        const uiGcode = "gcode/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/ui-old.gcode";
        const archiveKey = `manufacturing-archive/${USER}/old.stl`;
        const bucket = memoryBucket([
            { key: freshTemp, createdAt: hoursBefore(23) },
            { key: staleTemp, createdAt: hoursBefore(25) },
            { key: freshGcode, createdAt: hoursBefore(1) },
            { key: staleGcode, createdAt: hoursBefore(25), bytes: Buffer.from(FIXTURE_GCODE) },
            { key: uiGcode, createdAt: hoursBefore(30) },
            { key: archiveKey, createdAt: hoursBefore(100) },
            { key: `manufacturing-temp/${USER}/undated.stl` },
        ]);

        expect(await deleteCadOperatorGcodeAfterVoAttach(bucket.client, staleGcode)).toBe(true);
        expect(await deleteCadOperatorGcodeAfterVoAttach(bucket.client, uiGcode)).toBe(false);
        expect(bucket.objects.some((object) => object.key === staleGcode)).toBe(false);
        expect(bucket.objects.some((object) => object.key === uiGcode)).toBe(true);

        const summary = await cleanupManufacturingTempObjects(bucket.client, 48, "vertex-manufacturing", NOW);
        expect(MANUFACTURING_SWEEP_MAX_AGE_HOURS).toBe(24);
        expect(summary.deleted).toBe(2);
        expect(summary.errors).toEqual([`missing created_at for manufacturing-temp/${USER}/undated.stl`]);
        const keys = bucket.objects.map((object) => object.key);
        expect(keys).toContain(freshTemp);
        expect(keys).toContain(freshGcode);
        expect(keys).toContain(archiveKey);
        expect(keys).not.toContain(staleTemp);
        expect(keys).not.toContain(uiGcode);
        expect(keys).toContain(`manufacturing-temp/${USER}/undated.stl`);
    });

    test("UI G-code download uses a short-lived signed URL and the sweep removes the object", async () => {
        const key = "gcode/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/Jane_Doe_ApexCore_L.gcode";
        const bucket = memoryBucket([
            { key, createdAt: new Date(NOW).toISOString(), bytes: Buffer.from(FIXTURE_GCODE) },
        ]);
        expect(MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC).toBeGreaterThan(0);
        expect(MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC).toBeLessThanOrEqual(60 * 60);
        const url = await signedDownloadUrl(
            bucket.client,
            key,
            MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC,
            "vertex-manufacturing",
        );
        expect(url).toBe(`https://files.example.test/${key}?exp=${MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC}`);
        const bytes = bucket.objects.find((object) => object.key === key)?.bytes;
        expect(Buffer.from(bytes ?? []).toString("utf8")).toBe(FIXTURE_GCODE);
        expect(bucket.objects).toHaveLength(1);

        const stored = bucket.objects[0];
        if (!stored) throw new Error("missing gcode");
        stored.createdAt = hoursBefore(25);
        const summary = await cleanupManufacturingTempObjects(bucket.client, 24, "vertex-manufacturing", NOW);
        expect(summary.deleted).toBe(1);
        expect(bucket.objects).toHaveLength(0);
    });

    test("stored archive STL is not downloaded again", async () => {
        const original = globalThis.fetch;
        let called = false;
        globalThis.fetch = (async () => {
            called = true;
            return new Response("stl");
        }) as typeof fetch;
        try {
            await expect(
                downloadManufacturingStl(
                    "https://files.example.test/manufacturing-archive/user/export.stl?token=1",
                ),
            ).rejects.toThrow(/stored manufacturing archive STL/);
            expect(called).toBe(false);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("the inventory script lists archive and stale objects and --confirm does not delete", async () => {
        expect(storedManufacturingListPlan(["--confirm"])).toEqual({
            confirmRequested: true,
            deletes: false,
        });
        expect(storedManufacturingListPlan([])).toEqual({ confirmRequested: false, deletes: false });
        const archiveKey = `manufacturing-archive/${USER}/kept.stl`;
        const staleTemp = `manufacturing-temp/${USER}/stale.stl`;
        const freshTemp = `manufacturing-temp/${USER}/fresh.stl`;
        const staleGcode = "gcode/design/stale.gcode";
        const bucket = memoryBucket([
            { key: archiveKey, createdAt: hoursBefore(2) },
            { key: staleTemp, createdAt: hoursBefore(25) },
            { key: freshTemp, createdAt: hoursBefore(1) },
            { key: staleGcode, createdAt: hoursBefore(26) },
        ]);
        const before = bucket.objects.map((object) => object.key);
        const inventory = await listStoredManufacturingFiles(bucket.client, 24, "vertex-manufacturing", NOW);
        expect(inventory.manufacturingArchive).toEqual([archiveKey]);
        expect(inventory.staleManufacturingTemp).toEqual([staleTemp]);
        expect(inventory.staleGcode).toEqual([staleGcode]);
        expect(bucket.objects.map((object) => object.key)).toEqual(before);
        expect(bucket.objects.map((object) => object.key)).toContain(freshTemp);
    });
});

function sessionIo(gcode: string, deleted: string[]): SessionManufacturingIo {
    return {
        assertActiveLicense: async () => undefined,
        verifyDesignOwner: async () => undefined,
        getTokenBalance: async () => 9,
        storageAvailable: () => true,
        signedDownloadUrl: async () => "https://files.example.test/temp.stl",
        downloadStl: async () => new Uint8Array([1, 2, 3]),
        sliceWithVertexSlice: async () => gcode,
        callManufacture: async () => {
            throw new Error("session gcode must not call Python");
        },
        charge: async (charge) => ({
            productionId: "33333333-3333-4333-8333-333333333333",
            exportId: "44444444-4444-4444-8444-444444444444",
            balance: 6,
            jobId: charge.p_job_id,
        }),
        uploadOutput: async (_key, bytes) => {
            expect(bytes.toString("utf8")).toBe(FIXTURE_GCODE);
        },
        signedOutputUrl: async (key) =>
            `https://files.example.test/${key}?exp=${MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC}`,
        updateExportStorage: async () => undefined,
        updateProductionGcode: async () => undefined,
        deleteTemp: async (key) => {
            deleted.push(key);
        },
    };
}
