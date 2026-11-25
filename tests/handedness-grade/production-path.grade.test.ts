// Independent grade of PR #439 (head c365eaf9). Run this file on that head.
// It is not product code. It drives the production functions that upload G-code.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, test } from "@rstest/core";
import type { ManufacturingClient } from "../../packages/mcp/src/clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../../packages/mcp/src/config.js";
import { buildVoAttachFilesHandoff } from "../../packages/mcp/src/payload/vo-attach-files.js";
import {
    exportSideSuffix as mcpExportSideSuffix,
    physicalSideLabel as mcpPhysicalSideLabel,
} from "../../packages/mcp/src/shared/export-filename.js";
import { handleOrthocadTool } from "../../packages/mcp/src/tools/handlers.js";
import {
    type CadProductionInsert,
    claimProduction,
    executeCadOperatorProduction,
    MemoryCadProductionStore,
    runCadSliceAttempt,
} from "../../vertex/server/src/lib/cad-operator-production.js";
import { detectGcodeFoot } from "../../vertex/server/src/lib/gcode-handedness.js";
import { buildManufacturingTempStlKey } from "../../vertex/server/src/lib/storage.js";
import { sliceWithVertexSlice } from "../../vertex/server/src/lib/vertexslice-client.js";
import {
    runSessionGenerateSolid,
    type SessionManufacturingIo,
} from "../../vertex/server/src/routers/manufacturing-session.js";
import {
    exportSideSuffix,
    physicalSideLabel,
    SAMPLE_TOP_TEMPLATE_ASSET_ID,
} from "../../vertex/shared/export-filename.js";
import type { PrintRecipeV1 } from "../../vertex/shared/print-recipe/print-recipe.js";

const ROOT = resolve(__dirname, "../..");
const LEFT_MISMATCH =
    "Handedness check failed: requested left, G-code is a physical right foot. File not delivered.";
const RIGHT_MISMATCH =
    "Handedness check failed: requested right, G-code is a physical left foot. File not delivered.";

const recipe: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
    profileId: "apex-v2-insole-95a",
    defaultHardness: "Hard",
    zones: [],
};

function fixture(name: string): string {
    return gunzipSync(
        readFileSync(resolve(__dirname, "../fixtures/handedness", `${name}.gcode.gz`)),
    ).toString("utf8");
}

function triangleStl(): Uint8Array {
    const buf = Buffer.alloc(84 + 50);
    buf.writeUInt32LE(1, 80);
    const verts = [0, 0, 0, 120, 0, 0, 0, 40, 8];
    for (let i = 0; i < verts.length; i++) buf.writeFloatLE(verts[i] ?? 0, 84 + 12 + i * 4);
    return new Uint8Array(buf);
}

let fingerprint = 0;

function insert(side: "left" | "right"): CadProductionInsert {
    fingerprint += 1;
    return {
        designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        side,
        presetId: "apex-v2-insole-95a",
        idempotencyKey: `grade:${side}:${fingerprint}`,
        settingsFingerprint: `grade-fp-${fingerprint}`,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

function installSliceFetch(mode: "sync" | "job", gcode: string, nowMs: number): string[] {
    const calls: string[] = [];
    const job = { id: `job-${fingerprint}`, acceptedAt: 0, gcode };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push(`${method} ${url}`);
        if (url.includes("vertexorders") || url.includes("attach_files") || url.includes("/vo/")) {
            throw new Error(`VO attach fetch during production: ${method} ${url}`);
        }
        if (url.endsWith("/v1/materials")) {
            return new Response(JSON.stringify(["apex_core"]), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (method === "POST" && url.endsWith("/v1/slice/jobs")) {
            if (mode === "sync") return new Response("not deployed", { status: 404 });
            job.acceptedAt = nowMs;
            return new Response(JSON.stringify({ job_id: job.id, status: "queued", position: 1 }), {
                status: 202,
                headers: { "content-type": "application/json" },
            });
        }
        if (method === "GET" && url.includes("/v1/slice/jobs/") && url.endsWith("/result")) {
            return new Response(job.gcode, { status: 200, headers: { "content-type": "text/plain" } });
        }
        if (method === "GET" && url.includes("/v1/slice/jobs/")) {
            const accepted = job.acceptedAt || nowMs;
            return new Response(
                JSON.stringify({
                    job_id: job.id,
                    status: "succeeded",
                    position: null,
                    queued_at: new Date(accepted).toISOString(),
                    started_at: new Date(accepted).toISOString(),
                    finished_at: new Date(accepted).toISOString(),
                    elapsed_s: 0,
                    error: null,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }
        if (method === "POST" && url.endsWith("/v1/slice")) {
            return new Response(gcode, { status: 200, headers: { "content-type": "text/plain" } });
        }
        return new Response(`unexpected ${method} ${url}`, { status: 500 });
    }) as typeof fetch;
    return calls;
}

interface ProductionRun {
    status: string | undefined;
    error: string | null | undefined;
    uploads: number;
    charges: number;
    attaches: number;
    uploaded: string;
    storageKey: string | null | undefined;
}

async function runBeltProduction(
    side: "left" | "right",
    mode: "sync" | "job",
    gcode: string,
): Promise<ProductionRun> {
    const now = new Date("2026-11-24T00:00:00.000Z");
    process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
    process.env.VERTEXSLICE_API_KEY = "grade-key";
    const happy = (globalThis as { happyDOM?: { settings: { fetch: { disableSameOriginPolicy: boolean } } } })
        .happyDOM;
    if (happy) happy.settings.fetch.disableSameOriginPolicy = true;
    installSliceFetch(mode, gcode, now.getTime());
    const foot = triangleStl();
    const store = new MemoryCadProductionStore();
    const claimed = await claimProduction(store, insert(side), now);
    let uploads = 0;
    let charges = 0;
    let attaches = 0;
    let uploaded = "";
    await executeCadOperatorProduction({
        row: claimed.row,
        store,
        now: () => now,
        materialize: async () => ({ stlStorageKey: `tmp/${side}.stl`, meshFingerprint: "mesh" }),
        slice: async (stlStorageKey, sliceCtx) => {
            const attempt = await runCadSliceAttempt({
                request: sliceCtx?.checkpoint
                    ? null
                    : {
                          profileId: "apex-v2-insole-95a",
                          material: "apex_core",
                          model: foot,
                          filename: `${side}.stl`,
                          infillDensityPct: 32,
                          side,
                      },
                checkpoint: sliceCtx?.checkpoint ?? null,
                stlStorageKey,
                meshFingerprint: "mesh",
                credentialId: "cred",
                side,
                now: () => now,
                sleep: async () => undefined,
                budgetMs: sliceCtx?.budgetMs ?? 0,
                persistCheckpoint: sliceCtx?.persistCheckpoint,
            });
            if (attempt.kind === "pending") return { pending: true, checkpoint: attempt.checkpoint };
            return { gcode: attempt.gcode, jobId: attempt.jobId };
        },
        uploadGcode: async (body) => {
            uploads += 1;
            uploaded = body;
            return { storageKey: `gcode/${side}.gcode` };
        },
        charge: async () => {
            charges += 1;
            return { exportId: "exp", balance: 1, alreadyCharged: false };
        },
    });
    const row = await store.findById(claimed.row.id);
    if (row?.status === "succeeded") {
        attaches += 1;
        buildVoAttachFilesHandoff({
            order_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            patient_name: "Jane Doe",
            material: "apex_core",
            base_asset_id: SAMPLE_TOP_TEMPLATE_ASSET_ID,
            files: [
                {
                    side,
                    content_base64: Buffer.from(uploaded, "utf8").toString("base64"),
                    storage_key: `gcode/${side}.gcode`,
                },
            ],
            now: now.getTime(),
        });
    }
    return {
        status: row?.status,
        error: row?.error,
        uploads,
        charges,
        attaches,
        uploaded,
        storageKey: row?.gcodeStorageKey,
    };
}

function sessionIo(counts: { uploads: number; charges: number; uploaded: string }): SessionManufacturingIo {
    return {
        assertActiveLicense: async () => undefined,
        verifyDesignOwner: async () => undefined,
        getTokenBalance: async () => 9,
        storageAvailable: () => true,
        signedDownloadUrl: async () => "https://files.example.test/temp.stl",
        downloadStl: async () => triangleStl(),
        sliceWithVertexSlice,
        callManufacture: async () => {
            throw new Error("session gcode must not call Python");
        },
        charge: async (charge) => {
            counts.charges += 1;
            return {
                productionId: "33333333-3333-4333-8333-333333333333",
                exportId: "44444444-4444-4444-8444-444444444444",
                balance: 6,
                jobId: charge.p_job_id,
            };
        },
        uploadOutput: async (_key, bytes) => {
            counts.uploads += 1;
            counts.uploaded = bytes.toString("utf8");
        },
        signedOutputUrl: async () => "https://files.example.test/out.gcode",
        updateExportStorage: async () => undefined,
        updateProductionGcode: async () => undefined,
        archiveSourceStl: async () => undefined,
        deleteTemp: async () => undefined,
    };
}

function walk(dir: string, out: string[]): void {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(path);
    }
}

describe("independent production-path grade", () => {
    test("frozen gate files still match SHA256SUMS", () => {
        const sums = readFileSync(resolve(ROOT, "tests/fixtures/handedness/SHA256SUMS"), "utf8");
        for (const line of sums.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const [hex, rel] = trimmed.split(/\s+/, 2);
            const body = readFileSync(resolve(ROOT, rel ?? ""), null);
            expect(createHash("sha256").update(body).digest("hex")).toBe(hex);
        }
    });

    test("sync and job paths fail a left request of the main fixture before upload or VO attach", async () => {
        const mirrored = fixture("main_left_request_toe_first");
        for (const mode of ["sync", "job"] as const) {
            const run = await runBeltProduction("left", mode, mirrored);
            expect(run.status).toBe("failed");
            expect(run.error).toBe(LEFT_MISMATCH);
            expect(run.uploads).toBe(0);
            expect(run.charges).toBe(0);
            expect(run.attaches).toBe(0);
            expect(run.storageKey ?? null).toBeNull();
        }
    });

    test("true_left_toe_first is stored unchanged and sample-top VO side stays left", async () => {
        const trueLeft = fixture("true_left_toe_first");
        const run = await runBeltProduction("left", "sync", trueLeft);
        expect(run.status).toBe("succeeded");
        expect(run.uploads).toBe(1);
        expect(run.charges).toBe(1);
        expect(run.attaches).toBe(1);
        expect(run.uploaded).toBe(trueLeft);
        const attached = buildVoAttachFilesHandoff({
            order_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            patient_name: "Jane Doe",
            material: "apex_core",
            base_asset_id: "sample-top",
            files: [
                {
                    side: "left",
                    content_base64: Buffer.from(trueLeft, "utf8").toString("base64"),
                    storage_key: "gcode/left.gcode",
                },
            ],
            now: Date.parse("2026-11-24T00:00:00.000Z"),
        });
        expect(attached.vo_attach_files.files.map((file) => file.side)).toEqual(["left"]);
        expect(attached.vo_attach_files.files.map((file) => file.filename)).toEqual([
            "Jane_Doe_ApexCore_L.gcode",
        ]);
    });

    test("a pair checks both feet and delivers nothing when either foot disagrees", async () => {
        const mirrored = fixture("main_left_request_toe_first");
        const trueLeft = fixture("true_left_toe_first");
        const left = await runBeltProduction("left", "job", mirrored);
        const right = await runBeltProduction("right", "job", trueLeft);
        expect(left.error).toBe(LEFT_MISMATCH);
        expect(right.error).toBe(RIGHT_MISMATCH);
        expect(left.uploads + right.uploads).toBe(0);
        expect(left.attaches + right.attaches).toBe(0);
        expect(left.charges + right.charges).toBe(0);

        const seen: Array<"left" | "right"> = [];
        const errors: string[] = [];
        let chain: Promise<unknown> = Promise.resolve();
        const manufacturing = {
            async generateFromSavedDesign(input: { side: "left" | "right" }) {
                const run = chain.then(() =>
                    runBeltProduction(input.side, "sync", input.side === "left" ? mirrored : trueLeft),
                );
                chain = run.then(
                    () => undefined,
                    () => undefined,
                );
                const outcome = await run;
                seen.push(input.side);
                if (outcome.status !== "succeeded") {
                    errors.push(outcome.error ?? "");
                    throw new Error(outcome.error ?? "production failed");
                }
                return { productionId: "ok", status: "succeeded", side: input.side };
            },
        };
        const config: OrthocadMcpConfig = {
            apiBase: "http://127.0.0.1:3001",
            trpcUrl: "http://127.0.0.1:3001/trpc",
        };
        const response = await handleOrthocadTool(
            "generate_gcode",
            {
                use_saved_design: true,
                design_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                patient_name: "Jane Doe",
                material: "ApexCore",
                base_asset_id: "sample-top",
            },
            { config, manufacturing: manufacturing as unknown as ManufacturingClient },
        );
        expect(response.isError).toBe(true);
        expect(response.content[0]?.text).toContain("Belt pair failed on the left foot");
        expect(response.content[0]?.text).toContain("requested left");
        expect(response.content[0]?.text).toContain("physical right");
        expect(seen).toEqual(["left", "right"]);
        expect(errors[0]).toBe(LEFT_MISMATCH);
        expect(errors[1]).toBe(RIGHT_MISMATCH);
    });

    test("session generateSolid fails closed for a mirrored left and accepts a true left", async () => {
        const mirrored = fixture("main_left_request_toe_first");
        const trueLeft = fixture("true_left_toe_first");
        const userId = "grade-user";
        const stlStorageKey = buildManufacturingTempStlKey(userId, 9, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
        const now = new Date("2026-11-24T00:00:00.000Z");
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "grade-key";
        const happy = (
            globalThis as { happyDOM?: { settings: { fetch: { disableSameOriginPolicy: boolean } } } }
        ).happyDOM;
        if (happy) happy.settings.fetch.disableSameOriginPolicy = true;

        const failCounts = { uploads: 0, charges: 0, uploaded: "" };
        installSliceFetch("sync", mirrored, now.getTime());
        const failIo = sessionIo(failCounts);
        await expect(
            runSessionGenerateSolid({
                userId,
                ip: null,
                input: {
                    side: "left",
                    presetId: "apex-v2-insole-95a",
                    stlStorageKey,
                    outputType: "gcode",
                    beltAngleDeg: 45,
                    printRecipe: recipe,
                    material: "apex_core",
                },
                io: failIo,
            }),
        ).rejects.toThrow(LEFT_MISMATCH);
        expect(failCounts.uploads).toBe(0);
        expect(failCounts.charges).toBe(0);

        const okCounts = { uploads: 0, charges: 0, uploaded: "" };
        installSliceFetch("sync", trueLeft, now.getTime());
        const ok = await runSessionGenerateSolid({
            userId,
            ip: null,
            input: {
                side: "left",
                presetId: "apex-v2-insole-95a",
                stlStorageKey,
                outputType: "gcode",
                beltAngleDeg: 45,
                printRecipe: recipe,
                material: "apex_core",
            },
            io: sessionIo(okCounts),
        });
        expect(ok.ok).toBe(true);
        expect(okCounts.uploads).toBe(1);
        expect(okCounts.uploaded).toBe(trueLeft);

        const rightCounts = { uploads: 0, charges: 0, uploaded: "" };
        installSliceFetch("sync", trueLeft, now.getTime());
        await expect(
            runSessionGenerateSolid({
                userId,
                ip: null,
                input: {
                    side: "right",
                    presetId: "apex-v2-insole-95a",
                    stlStorageKey,
                    outputType: "gcode",
                    beltAngleDeg: 45,
                    printRecipe: recipe,
                    material: "apex_core",
                },
                io: sessionIo(rightCounts),
            }),
        ).rejects.toThrow(RIGHT_MISMATCH);
        expect(rightCounts.uploads).toBe(0);
        expect(rightCounts.charges).toBe(0);
    });

    test("every sliceWithVertexSlice and slice-job caller that can see a side is guarded", () => {
        const files: string[] = [];
        walk(resolve(ROOT, "vertex/server/src"), files);
        walk(resolve(ROOT, "vertex/src"), files);
        walk(resolve(ROOT, "packages/mcp/src"), files);
        const allow = new Set([
            "vertex/server/src/lib/vertexslice-client.ts",
            "vertex/server/src/lib/cad-operator-production.ts",
            "vertex/server/src/routers/manufacturing-session.ts",
            "vertex/server/src/routers/manufacturing.ts",
        ]);
        const mentions: string[] = [];
        const calls: string[] = [];
        for (const file of files) {
            if (/\.test\.(ts|tsx)$/.test(file)) continue;
            const rel = relative(ROOT, file);
            const text = readFileSync(file, "utf8");
            if (text.includes("sliceWithVertexSlice") || text.includes("downloadVertexSliceJobResult")) {
                mentions.push(rel);
            }
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? "";
                if (!/(sliceWithVertexSlice|downloadVertexSliceJobResult)\s*\(/.test(line)) continue;
                if (line.includes("function ")) continue;
                if (!line.includes("await")) continue;
                const window = lines.slice(i, i + 25).join("\n");
                const guarded =
                    window.includes("acceptCheckedGcode") || window.includes("assertGcodeHandedness");
                calls.push(`${rel}:${i + 1}${guarded ? "" : " UNGUARDED"}`);
                expect(guarded).toBe(true);
            }
        }
        mentions.sort();
        expect(mentions).toEqual([...allow].sort());
        expect(calls.length).toBeGreaterThan(0);
        const session = readFileSync(
            resolve(ROOT, "vertex/server/src/routers/manufacturing-session.ts"),
            "utf8",
        );
        const production = readFileSync(
            resolve(ROOT, "vertex/server/src/lib/cad-operator-production.ts"),
            "utf8",
        );
        const router = readFileSync(resolve(ROOT, "vertex/server/src/routers/manufacturing.ts"), "utf8");
        expect(session).not.toContain("buildVoAttachFilesHandoff");
        expect(production).not.toContain("buildVoAttachFilesHandoff");
        expect(router).toContain("sliceWithVertexSlice,");
        expect(router).toContain("runSessionGenerateSolid");
        expect(
            readFileSync(resolve(ROOT, "vertex/server/src/routers/cad-operator-generate.ts"), "utf8"),
        ).toContain("runCadSliceAttempt");
        console.log(`guarded slice callers:\n${calls.join("\n")}`);
    });

    test("SAMPLE_Top filename and VO side are the requested side", () => {
        const sampleTop = { assetId: SAMPLE_TOP_TEMPLATE_ASSET_ID };
        expect(physicalSideLabel("left", sampleTop)).toBe("left");
        expect(physicalSideLabel("right", sampleTop)).toBe("right");
        expect(mcpPhysicalSideLabel("left", sampleTop)).toBe("left");
        expect(mcpPhysicalSideLabel("right", sampleTop)).toBe("right");
        expect(exportSideSuffix("left", sampleTop)).toBe("L");
        expect(exportSideSuffix("right", sampleTop)).toBe("R");
        expect(mcpExportSideSuffix("left", sampleTop)).toBe("L");
        expect(mcpExportSideSuffix("right", sampleTop)).toBe("R");
        const source = readFileSync(resolve(ROOT, "vertex/src/lib/cnc/order-sides.ts"), "utf8");
        expect(source).not.toContain('=== "left" ? "right"');
        expect(source).toContain("physicalSideLabel");
    });

    test("a 3 MB G-code is classified in under 1.5 s", () => {
        const line = "G1 X1.00 Y0.20 Z10.00 E0.100\n";
        const bytes = 3 * 1024 * 1024;
        const gcode = line.repeat(Math.ceil(bytes / line.length));
        expect(gcode.length).toBeGreaterThanOrEqual(bytes);
        const started = performance.now();
        const detected = detectGcodeFoot(gcode);
        const elapsedMs = performance.now() - started;
        console.log(`grade 3MB guard ${gcode.length} bytes in ${elapsedMs.toFixed(1)} ms (${detected.foot})`);
        expect(elapsedMs).toBeLessThan(1500);
    });
});
