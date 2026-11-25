// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Grader-owned gate S1. Not the worker's trpc-cad-operator test.
// A left production generate for a design like 0d3db1c0 must loft the saved
// design twice, and must not read or refuse the seeded pre-#52 STL.

import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, rs, test } from "@rstest/core";
import {
    type CadOperatorPrincipal,
    cadOperatorTempPrefix,
    DOGFOOD_TENANT_ID,
} from "../../vertex/server/src/auth/cad-operator";
import * as contextMod from "../../vertex/server/src/context";
import {
    cadOperatorManufacturingIdentity,
    encodeSliceCheckpoint,
} from "../../vertex/server/src/lib/cad-operator-production";
import * as meshRunner from "../../vertex/server/src/lib/finalized-mesh-runner";
import { prepareManufacturingMeshForSlice } from "../../vertex/server/src/lib/slice-mesh";
import { buildManufacturingArchiveStlKey } from "../../vertex/server/src/lib/storage";
import { getVertexSliceBuild, UNKNOWN_SLICER_BUILD } from "../../vertex/server/src/lib/vertexslice-build";
import { runCadOperatorGenerateRequest } from "../../vertex/server/src/routers/cad-operator-generate";
import { prepareCadOperatorGenerate } from "../../vertex/server/src/routers/manufacturing-cad";
import { designSettingsEnvelope } from "../../vertex/shared/design-settings";
import { STALE_PRE52_BELT_MANUFACTURING_STL } from "../../vertex/shared/manufacturing-stl-identity";
import { designForPath, PATH_0D3DB1C0 } from "./production-fixtures";
import { SYNTHETIC_NAME } from "./thresholds";

const DESIGN_ID = "0d3db1c0-0000-4000-8000-0000000000d3";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SEEDED_PRODUCTION_ID = "grader-s1-stored-production";
const STALE_EXPORT_ID = "6590a003-2222-4222-8222-222222222222";
const CREDENTIAL_ID = "grader-s1-cred";
const REFUSE = "Refusing a stale pre-#52";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: CREDENTIAL_ID,
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function downloadBody(bytes: Uint8Array): { arrayBuffer: () => Promise<ArrayBuffer> } {
    return {
        arrayBuffer: async () => {
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            return copy;
        },
    };
}

/** Rstest rewrites the runner's file URLs. Stage the real stock files at those URLs. */
function stageRunnerAsset(targetUrl: string, source: string, directory = false): void {
    const dest = fileURLToPath(targetUrl);
    if (directory) {
        mkdirSync(dest, { recursive: true });
        cpSync(source, dest, { recursive: true });
        return;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
}

function leftGcode(): string {
    const body = gunzipSync(
        readFileSync(resolve("tests/fixtures/handedness/true_left_toe_first.gcode.gz")),
    ).toString("utf8");
    return `; filament_type = apex_core\n${body}`;
}

describe("grader S1 stored STL is never the slice", () => {
    test("two left generates loft the saved design and never read the pre-#52 file", async () => {
        stageRunnerAsset(meshRunner.sampleTopFileUrl(), resolve("vertex/public/Templates/SAMPLE_Top.glb"));
        stageRunnerAsset(meshRunner.textFontFileUrl(), resolve("vertex/public/fonts/Inter-Bold.ttf"));
        stageRunnerAsset(meshRunner.elementsDirectoryUrl(), resolve("vertex/public/elements"), true);

        const previousRegional = process.env.VERTEXSLICE_REGIONAL_3MF;
        const previousUrl = process.env.VERTEXSLICE_SLICER_URL;
        const previousKey = process.env.VERTEXSLICE_API_KEY;
        delete process.env.VERTEXSLICE_REGIONAL_3MF;
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "grader-s1";

        const staleTemp = `${cadOperatorTempPrefix(CREDENTIAL_ID)}1795583578275-7278a0ac-1111-4111-8111-111111111111.stl`;
        const staleArchive = buildManufacturingArchiveStlKey(OWNER_ID, STALE_EXPORT_ID);
        const staleBytes = Buffer.alloc(STALE_PRE52_BELT_MANUFACTURING_STL.sizeBytes, 0x5a);
        const staleMeta = {
            etag: STALE_PRE52_BELT_MANUFACTURING_STL.etag,
            sizeBytes: staleBytes.byteLength,
        };
        const objects = new Map<string, Buffer>([
            [staleTemp, staleBytes],
            [staleArchive, staleBytes],
        ]);
        const objectMeta = new Map<string, { etag: string; sizeBytes: number }>([
            [staleTemp, staleMeta],
            [staleArchive, staleMeta],
        ]);
        const downloads: string[] = [];
        const signedUrls: string[] = [];
        const exportSelects: string[] = [];
        const fetchedUrls: string[] = [];
        const postedModels: Uint8Array[] = [];

        const designState = designForPath(PATH_0D3DB1C0);
        let settingsJson: unknown = designSettingsEnvelope(JSON.parse(JSON.stringify(designState)));
        const designRow = () => ({
            id: DESIGN_ID,
            ownerId: OWNER_ID,
            name: DESIGN_ID,
            kind: "insole",
            pattern: "gyroid",
            method: "printing_solid",
            thicknessMm: designState.thicknessMm,
            linked: designState.corrections.linked,
            unit: "mm",
            settingsJson,
            updatedAt: new Date("2026-11-25T07:24:00.000Z"),
            deletedAt: null,
            client: { tenantId: DOGFOOD_TENANT_ID, firstName: "", lastName: "" },
            integrationLink: {
                tenantId: DOGFOOD_TENANT_ID,
                source: "vo2",
                externalOrderId: DESIGN_ID,
                sides: "both",
            },
        });

        const productions = new Map<string, Record<string, unknown>>();
        const sameValue = (actual: unknown, value: unknown) => {
            if (actual instanceof Date && value instanceof Date) return actual.getTime() === value.getTime();
            return actual === value;
        };
        const production = {
            async create({ data }: { data: Record<string, unknown> }) {
                const row = { ...data };
                productions.set(String(data.id), row);
                return row;
            },
            async findUnique({ where }: { where: { id?: string; idempotencyKey?: string } }) {
                if (where.id) return productions.get(where.id) ?? null;
                if (where.idempotencyKey) {
                    return (
                        [...productions.values()].find(
                            (row) => row.idempotencyKey === where.idempotencyKey,
                        ) ?? null
                    );
                }
                return null;
            },
            async updateMany({
                where,
                data,
            }: {
                where: Record<string, unknown>;
                data: Record<string, unknown>;
            }) {
                const row = productions.get(String(where.id));
                if (!row) return { count: 0 };
                const matches = Object.entries(where).every(([key, value]) => sameValue(row[key], value));
                if (!matches) return { count: 0 };
                for (const [key, value] of Object.entries(data)) {
                    if (value !== undefined) row[key] = value;
                }
                return { count: 1 };
            },
            async findMany({ where }: { where?: Record<string, unknown> } = {}) {
                return [...productions.values()].filter((row) => {
                    if (!where) return true;
                    if (where.designId && row.designId !== where.designId) return false;
                    if (where.side && row.side !== where.side) return false;
                    if (where.presetId && row.presetId !== where.presetId) return false;
                    if (where.settingsFingerprint && row.settingsFingerprint !== where.settingsFingerprint)
                        return false;
                    const status = where.status as { in?: string[] } | undefined;
                    if (status?.in && !status.in.includes(String(row.status))) return false;
                    return true;
                });
            },
        };
        const prisma = {
            design: {
                findUnique: async () => designRow(),
                update: async ({ data }: { data: { settingsJson?: unknown } }) => {
                    if (data.settingsJson !== undefined) settingsJson = data.settingsJson;
                    return designRow();
                },
            },
            production,
            $queryRaw: async () => [
                { result: { exportId: "grader-s1-charge", balance: 4, alreadyCharged: false } },
            ],
        } as unknown as PrismaClient;

        const adminSpy = rs.spyOn(contextMod, "getSupabaseAdmin").mockReturnValue({
            rpc: async () => ({ data: null, error: null }),
            from: (table: string) => ({
                select: () => ({
                    eq: () => ({
                        single: async () => {
                            if (table === "exports") {
                                exportSelects.push(staleArchive);
                                return {
                                    data: { id: STALE_EXPORT_ID, sourceStlPath: staleArchive },
                                    error: null,
                                };
                            }
                            if (table === "users") return { data: { tokenBalance: 50 }, error: null };
                            return { data: null, error: { message: "missing" } };
                        },
                    }),
                }),
                update: () => ({
                    eq: async () => ({ error: null }),
                }),
            }),
            storage: {
                from: () => ({
                    upload: async (key: string, data: Buffer) => {
                        const bytes = Buffer.from(data);
                        objects.set(key, bytes);
                        objectMeta.set(key, { etag: "fresh-upload", sizeBytes: bytes.byteLength });
                        return { error: null };
                    },
                    createSignedUrl: async (key: string) => {
                        signedUrls.push(key);
                        return {
                            data: { signedUrl: `http://127.0.0.1/object/${encodeURIComponent(key)}` },
                            error: null,
                        };
                    },
                    download: async (key: string) => {
                        downloads.push(key);
                        const bytes = objects.get(key);
                        if (!bytes) return { data: null, error: { message: "missing" } };
                        return { data: downloadBody(bytes), error: null };
                    },
                    list: async () => ({
                        data: [
                            {
                                name: "1795583578275-7278a0ac-1111-4111-8111-111111111111.stl",
                                id: "stale-temp",
                                created_at: "2026-11-24T19:13:17.000Z",
                            },
                        ],
                        error: null,
                    }),
                    remove: async () => ({ error: null }),
                }),
            },
        } as never);

        const lofted: Uint8Array[] = [];
        const originalLoft = meshRunner.buildHeadlessFinalizedFoot;
        const loftSpy = rs
            .spyOn(meshRunner, "buildHeadlessFinalizedFoot")
            .mockImplementation(async (input) => {
                const foot = await originalLoft(input);
                lofted.push(new Uint8Array(foot.stl));
                return foot;
            });

        const previousFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            fetchedUrls.push(url);
            if (
                url.includes("1795583578275") ||
                url.includes("6590a003") ||
                url.includes(STALE_PRE52_BELT_MANUFACTURING_STL.etag) ||
                url.includes("8f5dc451")
            ) {
                throw new Error(REFUSE);
            }
            if (url.endsWith("/health")) return new Response("no build", { status: 500 });
            if (url.endsWith("/v1/materials"))
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            if (url.endsWith("/v1/slice/jobs"))
                return new Response("job route is not deployed", { status: 404 });
            if (url.endsWith("/v1/slice")) {
                const model = (init?.body as FormData | undefined)?.get("model");
                if (model instanceof Blob) postedModels.push(new Uint8Array(await model.arrayBuffer()));
                return new Response(leftGcode(), { status: 200 });
            }
            return new Response("unexpected", { status: 500 });
        }) as typeof fetch;

        try {
            await getVertexSliceBuild();
            const plan = await prepareCadOperatorGenerate({
                prisma,
                principal,
                designId: DESIGN_ID,
                side: "left",
                outputType: "gcode",
                useSavedDesignMesh: true,
                stlStorageKey: "saved-design-internal",
                patientName: SYNTHETIC_NAME,
                hardness: "Medium",
                presetId: "apex-v2-insole-95a",
                material: "apex_core",
            });
            const identity = cadOperatorManufacturingIdentity({
                designId: DESIGN_ID,
                side: "left",
                presetId: plan.presetId,
                useSavedDesignMesh: true,
                material: plan.material,
                beltAngleDeg: plan.beltAngleDeg,
                layerHeightMm: null,
                printRecipe: plan.printRecipe,
                settingsJson: plan.settingsJson,
                stlStorageKey: null,
                slicerBuild: (await getVertexSliceBuild()) ?? UNKNOWN_SLICER_BUILD,
            });
            const now = new Date("2026-11-25T07:27:00.000Z");
            await production.create({
                data: {
                    id: SEEDED_PRODUCTION_ID,
                    designId: DESIGN_ID,
                    side: "left",
                    presetId: plan.presetId,
                    status: "failed",
                    idempotencyKey: identity.idempotencyKey,
                    settingsFingerprint: identity.fingerprint,
                    gcodeStorageKey: null,
                    error: encodeSliceCheckpoint({
                        v: 1,
                        jobId: "stored-pre52-job",
                        acceptedAt: "2026-11-24T19:13:17.000Z",
                        stlStorageKey: staleTemp,
                        meshFingerprint: "stored-pre52",
                        expectedRegionCount: 1,
                        credentialId: CREDENTIAL_ID,
                        serverStartedAt: null,
                    }),
                    createdAt: now,
                    updatedAt: now,
                    leaseExpiresAt: null,
                    chargedAt: null,
                    exportId: STALE_EXPORT_ID,
                    method: "printing_solid",
                    beltAngleDeg: plan.beltAngleDeg,
                    layerHeightMm: null,
                    material: plan.material,
                },
            });

            const input = {
                designId: DESIGN_ID,
                side: "left" as const,
                presetId: "apex-v2-insole-95a",
                stlStorageKey: "saved-design-internal",
                outputType: "gcode" as const,
                beltAngleDeg: 45,
                useSavedDesignMesh: true,
                patientName: SYNTHETIC_NAME,
                hardness: "Medium" as const,
                material: "apex_core",
            };
            for (let attempt = 0; attempt < 2; attempt++) {
                let scheduled: Promise<void> | null = null;
                const started = await runCadOperatorGenerateRequest({
                    prisma,
                    principal,
                    ip: null,
                    now: () => now,
                    schedule: (work) => {
                        scheduled = work;
                    },
                    input,
                });
                expect(started.ok).toBe(true);
                expect(started.side).toBe("left");
                if (!scheduled) throw new Error("production generate was not scheduled");
                await scheduled;
            }

            expect(loftSpy).toHaveBeenCalledTimes(2);
            expect(lofted).toHaveLength(2);
            const loftHash = sha256(lofted[0] ?? new Uint8Array());
            expect(sha256(lofted[1] ?? new Uint8Array())).toBe(loftHash);
            expect(lofted[0]?.byteLength).not.toBe(STALE_PRE52_BELT_MANUFACTURING_STL.sizeBytes);
            for (const call of loftSpy.mock.calls) {
                const settings = (call[0].settingsJson as { settings?: { usMenSize?: number } }).settings;
                expect(call[0].side).toBe("left");
                expect(settings?.usMenSize).toBe(PATH_0D3DB1C0.size);
            }
            const prepared = prepareManufacturingMeshForSlice(lofted[0] ?? new Uint8Array());
            expect(postedModels.length).toBeGreaterThanOrEqual(2);
            for (const model of postedModels) {
                expect(model.byteLength).not.toBe(STALE_PRE52_BELT_MANUFACTURING_STL.sizeBytes);
                expect(sha256(model)).toBe(sha256(prepared));
            }

            const staleKeys = new Set([staleTemp, staleArchive]);
            expect(downloads.filter((key) => staleKeys.has(key))).toEqual([]);
            expect(signedUrls.filter((key) => staleKeys.has(key))).toEqual([]);
            expect(exportSelects).toEqual([]);
            expect(fetchedUrls.some((url) => url.includes(STALE_PRE52_BELT_MANUFACTURING_STL.etag))).toBe(
                false,
            );
            for (const key of downloads) {
                expect(objectMeta.get(key)?.etag).not.toBe(STALE_PRE52_BELT_MANUFACTURING_STL.etag);
            }

            const seeded = productions.get(SEEDED_PRODUCTION_ID);
            expect(seeded?.status).toBe("failed");
            expect(String(seeded?.error ?? "")).toContain(staleTemp);
            expect(String(seeded?.error ?? "")).not.toContain(REFUSE);
            const fresh = [...productions.values()].filter((row) =>
                String(row.idempotencyKey).startsWith(`${identity.idempotencyKey}:fresh:`),
            );
            expect(fresh).toHaveLength(2);
            for (const row of fresh) {
                expect(row.status).toBe("succeeded");
                expect(String(row.error ?? "")).not.toContain(REFUSE);
                expect(String(row.error ?? "")).not.toContain(STALE_PRE52_BELT_MANUFACTURING_STL.etag);
            }
        } finally {
            loftSpy.mockRestore();
            adminSpy.mockRestore();
            globalThis.fetch = previousFetch;
            if (previousRegional === undefined) delete process.env.VERTEXSLICE_REGIONAL_3MF;
            else process.env.VERTEXSLICE_REGIONAL_3MF = previousRegional;
            if (previousUrl === undefined) delete process.env.VERTEXSLICE_SLICER_URL;
            else process.env.VERTEXSLICE_SLICER_URL = previousUrl;
            if (previousKey === undefined) delete process.env.VERTEXSLICE_API_KEY;
            else process.env.VERTEXSLICE_API_KEY = previousKey;
        }
    }, 300_000);
});
