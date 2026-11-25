// Independent grade of the production G-code handedness guard.
// Drives executeCadOperatorProduction -> runCadSliceAttempt (sync fallback and
// slice-job result) and runSessionGenerateSolid. VertexSlice is stubbed at fetch.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test, afterEach } from "@rstest/core";
import { buildVoAttachFilesHandoff } from "../../packages/mcp/src/payload/vo-attach-files.js";
import type { PrintRecipeV1 } from "../../vertex/shared/print-recipe/print-recipe.js";
import {
    claimProduction,
    executeCadOperatorProduction,
    MemoryCadProductionStore,
    runCadSliceAttempt,
    type CadProductionInsert,
} from "../../vertex/server/src/lib/cad-operator-production.js";
import { buildManufacturingTempStlKey } from "../../vertex/server/src/lib/storage.js";
import { detectGcodeFoot } from "../../vertex/server/src/lib/gcode-handedness.js";
import {
    runSessionGenerateSolid,
    type SessionManufacturingIo,
} from "../../vertex/server/src/routers/manufacturing-session.js";

const ORDER_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISMATCH =
    "Handedness check failed: requested left, G-code is a physical right foot. File not delivered.";

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

function installVertexSlice(bodyFor: (side: "left" | "right") => string, mode: "sync" | "job"): void {
    process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
    process.env.VERTEXSLICE_API_KEY = "grade-stub-key";
    let posted = 0;
    const jobs: Array<{ id: string; gcode: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.endsWith("/v1/materials")) {
            return new Response(JSON.stringify(["apex_core"]), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (method === "POST" && url.endsWith("/v1/slice/jobs")) {
            if (mode === "sync") return new Response("not deployed", { status: 404 });
            const side = posted % 2 === 0 ? "left" : "right";
            posted += 1;
            const job = { id: `grade-job-${posted}`, gcode: bodyFor(side) };
            jobs.push(job);
            return new Response(JSON.stringify({ job_id: job.id, status: "queued", position: posted }), {
                status: 202,
                headers: { "content-type": "application/json" },
            });
        }
        const result = url.match(/\/v1\/slice\/jobs\/([^/]+)\/result$/);
        if (result) {
            const job = jobs.find((item) => item.id === decodeURIComponent(result[1] ?? ""));
            if (!job) return new Response("missing", { status: 404 });
            return new Response(job.gcode, { status: 200, headers: { "content-type": "text/plain" } });
        }
        const status = url.match(/\/v1\/slice\/jobs\/([^/]+)$/);
        if (status && method === "GET") {
            const job = jobs.find((item) => item.id === decodeURIComponent(status[1] ?? ""));
            if (!job) return new Response("missing", { status: 404 });
            const now = new Date().toISOString();
            return new Response(
                JSON.stringify({
                    job_id: job.id,
                    status: "succeeded",
                    position: null,
                    queued_at: now,
                    started_at: now,
                    finished_at: now,
                    elapsed_s: 0,
                    error: null,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }
        if (method === "POST" && url.endsWith("/v1/slice")) {
            const form = init?.body;
            const filename =
                form instanceof FormData ? String(form.get("filename") ?? form.get("file") ?? "") : "";
            const side: "left" | "right" = filename.includes("right") ? "right" : "left";
            return new Response(bodyFor(side), {
                status: 200,
                headers: { "content-type": "text/plain" },
            });
        }
        return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.VERTEXSLICE_SLICER_URL;
    delete process.env.VERTEXSLICE_API_KEY;
});

function insert(side: "left" | "right", fingerprint: string): CadProductionInsert {
    return {
        designId: DESIGN_ID,
        side,
        presetId: "apex-v2-insole-95a",
        idempotencyKey: `grade:${side}:${fingerprint}`,
        settingsFingerprint: fingerprint,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

async function produce(args: {
    side: "left" | "right";
    fingerprint: string;
    mode: "sync" | "job";
    bodyFor: (side: "left" | "right") => string;
}): Promise<{
    status: string | undefined;
    error: string | null;
    uploads: string[];
    charges: number;
    attaches: number;
}> {
    installVertexSlice(args.bodyFor, args.mode);
    const now = new Date("2026-11-24T23:00:00.000Z");
    const store = new MemoryCadProductionStore();
    const claimed = await claimProduction(store, insert(args.side, args.fingerprint), now);
    const uploads: string[] = [];
    let charges = 0;
    let attaches = 0;
    const foot = triangleStl();
    await executeCadOperatorProduction({
        row: claimed.row,
        store,
        now: () => now,
        materialize: async () => ({ stlStorageKey: `tmp/${args.side}.stl`, meshFingerprint: "mesh" }),
        slice: async (stlStorageKey, sliceCtx) => {
            const attempt = await runCadSliceAttempt({
                request: sliceCtx?.checkpoint
                    ? null
                    : {
                          profileId: "apex-v2-insole-95a",
                          material: "apex_core",
                          model: foot,
                          filename: `${args.side}.stl`,
                          infillDensityPct: 32,
                          side: args.side,
                          sliceTimeoutMs: sliceCtx?.sliceTimeoutMs,
                      },
                checkpoint: sliceCtx?.checkpoint ?? null,
                stlStorageKey,
                meshFingerprint: "mesh",
                credentialId: "cred",
                side: args.side,
                now: () => now,
                sleep: async () => undefined,
                budgetMs: sliceCtx?.budgetMs ?? 5_000,
                persistCheckpoint: sliceCtx?.persistCheckpoint,
            });
            if (attempt.kind === "pending") return { pending: true, checkpoint: attempt.checkpoint };
            return { gcode: attempt.gcode, jobId: attempt.jobId };
        },
        uploadGcode: async (gcode) => {
            uploads.push(gcode);
            return { storageKey: `gcode/cad-operator/${args.side}.gcode` };
        },
        charge: async () => {
            charges += 1;
            return { exportId: "exp", balance: 1, alreadyCharged: false };
        },
    });
    const row = await store.findById(claimed.row.id);
    if (row?.status === "succeeded" && uploads.length === 1) {
        attaches += 1;
        const attached = buildVoAttachFilesHandoff({
            order_id: ORDER_ID,
            patient_name: "Sample Patient",
            material: "apex_core",
            base_asset_id: "sample-top",
            files: [
                {
                    side: args.side,
                    content_base64: Buffer.from(uploads[0] ?? "", "utf8").toString("base64"),
                    storage_key: `gcode/cad-operator/${args.side}.gcode`,
                },
            ],
            now: now.getTime(),
        });
        expect(attached.vo_attach_files.files[0]?.side).toBe(args.side);
        const filename = attached.vo_attach_files.files[0]?.filename ?? "";
        expect(filename.endsWith(args.side === "left" ? "_L.gcode" : "_R.gcode")).toBe(true);
        expect(filename.includes(args.side === "left" ? "_R.gcode" : "_L.gcode")).toBe(false);
    }
    return { status: row?.status, error: row?.error ?? null, uploads, charges, attaches };
}

describe("independent production handedness grade", () => {
    test("sync VertexSlice: left request of main_left_request_toe_first fails before upload or attach", async () => {
        const mirrored = fixture("main_left_request_toe_first");
        const failed = await produce({
            side: "left",
            fingerprint: "sync-left-mirrored",
            mode: "sync",
            bodyFor: () => mirrored,
        });
        expect(failed.status).toBe("failed");
        expect(failed.error).toBe(MISMATCH);
        expect(failed.error?.toLowerCase()).toContain("requested left");
        expect(failed.error?.toLowerCase()).toContain("physical right");
        expect(failed.uploads).toEqual([]);
        expect(failed.charges).toBe(0);
        expect(failed.attaches).toBe(0);
    });

    test("slice-job result: the same left mismatch fails before upload or attach", async () => {
        const mirrored = fixture("main_left_request_toe_first");
        const failed = await produce({
            side: "left",
            fingerprint: "job-left-mirrored",
            mode: "job",
            bodyFor: () => mirrored,
        });
        expect(failed.status).toBe("failed");
        expect(failed.error).toBe(MISMATCH);
        expect(failed.uploads).toEqual([]);
        expect(failed.charges).toBe(0);
        expect(failed.attaches).toBe(0);
    });

    test("true_left_toe_first requested as left is stored unchanged", async () => {
        const trueLeft = fixture("true_left_toe_first");
        const delivered = await produce({
            side: "left",
            fingerprint: "sync-left-true",
            mode: "sync",
            bodyFor: () => trueLeft,
        });
        expect(delivered.status).toBe("succeeded");
        expect(delivered.uploads).toEqual([trueLeft]);
        expect(delivered.charges).toBe(1);
        expect(delivered.attaches).toBe(1);
    });

    test("a pair checks both feet and delivers neither mismatched file", async () => {
        const mirrored = fixture("main_left_request_toe_first");
        const trueLeft = fixture("true_left_toe_first");
        const left = await produce({
            side: "left",
            fingerprint: "pair-left",
            mode: "job",
            bodyFor: () => mirrored,
        });
        const right = await produce({
            side: "right",
            fingerprint: "pair-right",
            mode: "sync",
            bodyFor: () => trueLeft,
        });
        expect(left.status).toBe("failed");
        expect(left.error).toBe(MISMATCH);
        expect(left.uploads).toEqual([]);
        expect(left.attaches).toBe(0);
        expect(right.status).toBe("failed");
        expect(right.error).toContain("requested right");
        expect(right.error?.toLowerCase()).toContain("physical left");
        expect(right.uploads).toEqual([]);
        expect(right.charges).toBe(0);
        expect(right.attaches).toBe(0);
    });

    test("session generateSolid refuses the mirrored left file before charge or upload", async () => {
        const mirrored = fixture("main_left_request_toe_first");
        const trueLeft = fixture("true_left_toe_first");
        const stlKey = buildManufacturingTempStlKey(USER_ID, 11, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
        const uploads: string[] = [];
        let charges = 0;
        const io = (gcode: string): SessionManufacturingIo => ({
            assertActiveLicense: async () => undefined,
            verifyDesignOwner: async () => undefined,
            getTokenBalance: async () => 9,
            storageAvailable: () => true,
            signedDownloadUrl: async () => "https://files.example.test/temp.stl",
            downloadStl: async () => new Uint8Array([1, 2, 3]),
            sliceWithVertexSlice: async () => gcode,
            callManufacture: async () => {
                throw new Error("belt gcode must not call the python backend");
            },
            charge: async (charge) => {
                charges += 1;
                return {
                    productionId: "33333333-3333-4333-8333-333333333333",
                    exportId: "44444444-4444-4444-8444-444444444444",
                    balance: 6,
                    jobId: charge.p_job_id,
                };
            },
            uploadOutput: async (_key, bytes) => {
                uploads.push(bytes.toString("utf8"));
            },
            signedOutputUrl: async () => "https://files.example.test/out.gcode",
            updateExportStorage: async () => undefined,
            updateProductionGcode: async () => undefined,
            archiveSourceStl: async () => undefined,
            deleteTemp: async () => undefined,
        });
        const input = {
            designId: DESIGN_ID,
            side: "left" as const,
            presetId: "apex-v2-insole-95a",
            stlStorageKey: stlKey,
            outputType: "gcode" as const,
            beltAngleDeg: 45,
            printRecipe: recipe,
            material: "apex_core",
        };
        await expect(
            runSessionGenerateSolid({ userId: USER_ID, ip: null, input, io: io(mirrored) }),
        ).rejects.toThrow(MISMATCH);
        expect(uploads).toEqual([]);
        expect(charges).toBe(0);

        const rightInput = { ...input, side: "right" as const };
        await expect(
            runSessionGenerateSolid({ userId: USER_ID, ip: null, input: rightInput, io: io(trueLeft) }),
        ).rejects.toThrow(/requested right/);
        expect(uploads).toEqual([]);
        expect(charges).toBe(0);

        const ok = await runSessionGenerateSolid({
            userId: USER_ID,
            ip: null,
            input,
            io: io(trueLeft),
        });
        expect(ok.ok).toBe(true);
        expect(uploads).toEqual([trueLeft]);
        expect(charges).toBe(1);
    });

    test("a 3 MB G-code is classified by the production guard", () => {
        const line = "G1 X1.00 Y0.20 Z10.00 E0.100\n";
        const bytes = 3 * 1024 * 1024;
        const gcode = line.repeat(Math.ceil(bytes / line.length));
        expect(gcode.length).toBeGreaterThanOrEqual(bytes);
        const started = performance.now();
        const detected = detectGcodeFoot(gcode);
        const elapsedMs = performance.now() - started;
        console.log(`grade 3MB guard ${gcode.length} bytes in ${elapsedMs.toFixed(1)} ms (${detected.foot})`);
        expect(detected.foot).toBe("inconclusive");
        expect(elapsedMs).toBeLessThan(1500);
    });

    test("every production caller of sliceWithVertexSlice or the slice-job result checks the side", () => {
        const roots = [
            resolve(__dirname, "../../vertex/server/src"),
            resolve(__dirname, "../../packages/mcp/src"),
        ];
        const callers: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const path = resolve(dir, name);
                if (statSync(path).isDirectory()) {
                    walk(path);
                    continue;
                }
                if (!name.endsWith(".ts") && !name.endsWith(".mjs")) continue;
                if (name.includes(".test.")) continue;
                const text = readFileSync(path, "utf8");
                if (path.endsWith("vertexslice-client.ts")) continue;
                if (/sliceWithVertexSlice\s*\(/.test(text) || /downloadVertexSliceJobResult\s*\(/.test(text)) {
                    callers.push(path);
                    const guarded =
                        text.includes("acceptCheckedGcode") || text.includes("assertGcodeHandedness");
                    expect(guarded).toBe(true);
                }
            }
        };
        for (const root of roots) walk(root);
        const root = resolve(__dirname, "../..");
        const relative = callers.map((path) => path.slice(root.length + 1)).sort();
        expect(relative).toEqual([
            "vertex/server/src/lib/cad-operator-production.ts",
            "vertex/server/src/routers/manufacturing-session.ts",
        ]);
    });
});
