import { describe, expect, test } from "@rstest/core";

import { HARDNESS_TO_INFILL_PCT } from "../../../shared/print-recipe/hardness-to-infill-pct.js";
import type { PrintRecipeV1 } from "../../../shared/print-recipe/print-recipe.js";
import {
    assetLoadCauseForLog,
    beginCadOperatorProduction,
    CAD_PRODUCTION_LEASE_MS,
    type CadProductionInsert,
    cadOperatorManufacturingIdentity,
    claimProduction,
    executeCadOperatorProduction,
    expireStaleProduction,
    infillPctForCadSlice,
    isTransientStorageOrNetworkError,
    MemoryCadProductionStore,
    publicProductionError,
    TRANSIENT_IO_BACKOFF_MS,
    toPublicProduction,
    withOneTransientRetry,
} from "./cad-operator-production.js";
import { signedDownloadUrl, uploadAsset } from "./storage.js";

const recipe: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
    profileId: "apex-v2-insole-95a",
    defaultHardness: "Hard",
    zones: [],
};

function insert(side: "left" | "right", fingerprint = "fp-1"): CadProductionInsert {
    return {
        designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        side,
        presetId: "apex-v2-insole-95a",
        idempotencyKey: `cadop:v1:design:${side}:${fingerprint}`,
        settingsFingerprint: fingerprint,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

describe("CAD-operator production claim", () => {
    test("begin returns before slicing finishes", async () => {
        const store = new MemoryCadProductionStore();
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let scheduled: Promise<void> | null = null;
        const pending = beginCadOperatorProduction({
            store,
            insert: insert("left"),
            now: new Date("2026-11-09T00:00:00.000Z"),
            schedule: (work) => {
                scheduled = work;
            },
            execute: async () => {
                await gate;
            },
        });
        const started = await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error("generate blocked on slicing")), 50);
            }),
        ]);
        expect(started.status).toBe("pending");
        expect(started.productionId).toMatch(/^[0-9a-f-]{36}$/);
        release();
        await scheduled;
    });

    test("one success charges once, a second call reuses it, and a pair is two rows", async () => {
        const store = new MemoryCadProductionStore();
        let charges = 0;
        let scheduled: Promise<void> | null = null;
        const run = (side: "left" | "right") =>
            beginCadOperatorProduction({
                store,
                insert: insert(side),
                now: new Date("2026-11-09T00:00:00.000Z"),
                schedule: (work) => {
                    scheduled = work;
                },
                execute: (row) =>
                    executeCadOperatorProduction({
                        row,
                        store,
                        now: () => new Date("2026-11-09T00:00:02.000Z"),
                        materialize: async () => ({
                            stlStorageKey: `tmp/${side}.stl`,
                            meshFingerprint: "mesh",
                        }),
                        slice: async () => ({ gcode: "G1 X0\n", jobId: `job-${side}` }),
                        uploadGcode: async () => ({ storageKey: `gcode/cad-operator/t/c/d/${side}.gcode` }),
                        charge: async () => {
                            charges += 1;
                            return { exportId: `exp-${side}`, balance: 7, alreadyCharged: false };
                        },
                    }),
            });

        const left = await run("left");
        expect(charges).toBe(0);
        await scheduled;
        expect(charges).toBe(1);
        const done = await store.findById(left.productionId);
        expect(done?.status).toBe("succeeded");
        expect(done?.gcodeStorageKey).toBe("gcode/cad-operator/t/c/d/left.gcode");
        expect(done?.chargedAt).toBeTruthy();
        if (!done) throw new Error("production missing");
        const pub = toPublicProduction(done);
        expect(Object.keys(pub).sort()).toEqual(
            [
                "createdAt",
                "designId",
                "download",
                "error",
                "gcodeStorageKey",
                "presetId",
                "productionId",
                "side",
                "status",
                "updatedAt",
            ].sort(),
        );
        expect(pub.download).toEqual({ tool: "get_export_download", productionId: left.productionId });
        expect(JSON.stringify(pub)).not.toMatch(/patient|Jane/);

        let reran = false;
        const again = await beginCadOperatorProduction({
            store,
            insert: insert("left"),
            now: new Date("2026-11-09T00:00:03.000Z"),
            schedule: () => {},
            execute: async () => {
                reran = true;
            },
        });
        expect(again).toEqual({ productionId: left.productionId, status: "succeeded", side: "left" });
        expect(reran).toBe(false);
        expect(charges).toBe(1);

        const right = await run("right");
        await scheduled;
        expect(right.productionId).not.toBe(left.productionId);
        expect(charges).toBe(2);
    });

    test("a failed slice is not charged and a later call runs that row again", async () => {
        const store = new MemoryCadProductionStore();
        let charges = 0;
        let scheduled: Promise<void> | null = null;
        const start = (slice: () => Promise<{ gcode: string; jobId: string }>) =>
            beginCadOperatorProduction({
                store,
                insert: insert("left"),
                now: new Date("2026-11-09T00:00:00.000Z"),
                schedule: (work) => {
                    scheduled = work;
                },
                execute: (row) =>
                    executeCadOperatorProduction({
                        row,
                        store,
                        now: () => new Date(),
                        materialize: async () => ({ stlStorageKey: "tmp/a.stl", meshFingerprint: null }),
                        slice,
                        uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
                        charge: async () => {
                            charges += 1;
                            return { exportId: "exp-1", balance: 4, alreadyCharged: false };
                        },
                    }),
            });

        const failed = await start(async () => {
            throw new Error("patient Jane Doe loft exploded");
        });
        await scheduled;
        const row = await store.findById(failed.productionId);
        expect(row?.status).toBe("failed");
        expect(row?.error).toBe("Manufacturing failed");
        expect(row?.error).not.toMatch(/Jane/);
        expect(charges).toBe(0);

        const again = await start(async () => ({ gcode: "G1 X0\n", jobId: "job-2" }));
        expect(again.productionId).toBe(failed.productionId);
        expect(again.status).toBe("pending");
        await scheduled;
        expect(charges).toBe(1);
        expect((await store.findById(again.productionId))?.status).toBe("succeeded");
    });

    test("concurrent claims share one row and an expired lease can be retried", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-09T00:00:00.000Z");
        let runs = 0;
        const claim = () =>
            beginCadOperatorProduction({
                store,
                insert: insert("left", "same"),
                now,
                schedule: (work) => {
                    void work;
                },
                execute: async () => {
                    runs += 1;
                },
            });
        const [first, second] = await Promise.all([claim(), claim()]);
        expect(first.productionId).toBe(second.productionId);
        expect(runs).toBe(1);
        expect([first.status, second.status].sort()).toEqual(["pending", "pending"]);

        const later = new Date(now.getTime() + CAD_PRODUCTION_LEASE_MS + 1);
        const expired = await expireStaleProduction(store, first.productionId, later);
        expect(expired?.status).toBe("failed");
        expect(expired?.error).toBe("Production lease expired");
        const rerun = await claimProduction(store, insert("left", "same"), later);
        expect(rerun.run).toBe(true);
        expect(rerun.row.id).toBe(first.productionId);
        expect(rerun.row.status).toBe("pending");
    });

    test("an already charged row is not charged again, and Hard gyroid stays 32%", async () => {
        expect(HARDNESS_TO_INFILL_PCT.Hard).toBe(32);
        expect(infillPctForCadSlice("apex-v2-insole-95a", recipe)).toBe(32);
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(store, insert("left"), new Date("2026-11-09T00:00:00.000Z"));
        await store.updateIf(claimed.row.id, () => true, {
            status: "running",
            chargedAt: new Date("2026-11-09T00:00:01.000Z"),
            exportId: "exp-1",
            gcodeStorageKey: "gcode/cad-operator/t/c/d/left.gcode",
        });
        let charges = 0;
        await executeCadOperatorProduction({
            row: (await store.findById(claimed.row.id)) ?? claimed.row,
            store,
            now: () => new Date("2026-11-09T00:00:02.000Z"),
            materialize: async () => {
                throw new Error("should not loft");
            },
            slice: async () => ({ gcode: "G1\n", jobId: "job" }),
            uploadGcode: async () => ({ storageKey: "other" }),
            charge: async () => {
                charges += 1;
                return { exportId: "exp-2", balance: 1, alreadyCharged: false };
            },
        });
        expect(charges).toBe(0);
        expect((await store.findById(claimed.row.id))?.status).toBe("succeeded");
        expect(
            publicProductionError(new Error("Canonical Export mesh is not available headless (Jane Doe)")),
        ).toBe("Canonical Export mesh is not available headless. Refusing to substitute a different mesh.");
        expect(
            assetLoadCauseForLog(new Error("Canonical Export mesh is not available headless (Jane Doe)")),
        ).toBeNull();
    });

    test("a failed loft logs the font or element cause and keeps the public row error", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-09T00:00:00.000Z");
        const claimed = await claimProduction(store, insert("left", "font-cause"), now);
        const fontError = new Error(
            "Canonical Export mesh is not available headless (Failed to parse URL from /fonts/Inter-Bold.ttf). Refusing to substitute a different mesh.",
        );
        const logged: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => {
            logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
        };
        try {
            await executeCadOperatorProduction({
                row: (await store.findById(claimed.row.id)) ?? claimed.row,
                store,
                now: () => new Date("2026-11-09T00:00:01.000Z"),
                materialize: async () => {
                    throw fontError;
                },
                slice: async () => ({ gcode: "G1\n", jobId: "job" }),
                uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
                charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
            });
        } finally {
            console.error = original;
        }
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("failed");
        expect(row?.error).toBe(
            "Canonical Export mesh is not available headless. Refusing to substitute a different mesh.",
        );
        expect(logged.join("\n")).toContain("Failed to parse URL from /fonts/Inter-Bold.ttf");
        expect(logged.join("\n")).not.toContain("Jane Doe");
        expect(assetLoadCauseForLog(fontError)).toBe("Failed to parse URL from /fonts/Inter-Bold.ttf");
        const elementError = new Error(
            "Canonical Export mesh is not available headless (Element asset /elements/met_bar_1.right.glb is not a GLB). Refusing to substitute a different mesh.",
        );
        expect(assetLoadCauseForLog(elementError)).toBe(
            "Element asset /elements/met_bar_1.right.glb is not a GLB",
        );
    });

    test("settings identity changes with the foot and stays stable for the same inputs", () => {
        const base = {
            designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            side: "left" as const,
            presetId: "apex-v2-insole-95a",
            useSavedDesignMesh: true,
            material: "apex_core",
            beltAngleDeg: 45,
            layerHeightMm: null,
            printRecipe: recipe,
            settingsJson: { schemaVersion: 1, settings: { thicknessMm: 3 } },
            stlStorageKey: null,
        };
        const left = cadOperatorManufacturingIdentity(base);
        const again = cadOperatorManufacturingIdentity({
            ...base,
            settingsJson: { settings: { thicknessMm: 3 }, schemaVersion: 1 },
        });
        const right = cadOperatorManufacturingIdentity({ ...base, side: "right" });
        expect(left.idempotencyKey).toBe(again.idempotencyKey);
        expect(left.idempotencyKey).not.toBe(right.idempotencyKey);
        expect(left.idempotencyKey).toContain(":left:");
        expect(left.idempotencyKey).toContain("apex-v2-insole-95a");
    });
});

const SECRET =
    'settingsJson {"firstName":"Jane Doe"} patientName Jane Doe ' +
    "https://proj.supabase.co/storage/v1/object/sign/bucket/file.stl?token=sekret-token Bearer sk_live_secret";

function expectRedacted(value: string): void {
    expect(value).not.toMatch(
        /settingsJson|Jane Doe|sekret|sk_live|https?:\/\/|\?|Bearer|patientName|firstName/,
    );
}

function capture(method: "error" | "warn" | "log"): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console[method];
    console[method] = (...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    };
    return {
        lines,
        restore() {
            console[method] = original;
        },
    };
}

describe("PHI-safe manufacturing errors", () => {
    test("storage and VertexSlice prefixes replace Manufacturing failed and drop secrets", () => {
        const cases: Array<[string, string]> = [
            ["Storage upload failed", `Storage upload failed: ${SECRET}`],
            ["Signed URL failed", `Signed URL failed: ${SECRET}`],
            ["Could not download manufacturing STL", `Could not download manufacturing STL: ${SECRET}`],
            [
                "Could not download manufacturing STL (404)",
                `Could not download manufacturing STL (404): ${SECRET}`,
            ],
            [
                "Could not reach VertexSlice",
                "Could not reach VertexSlice (https://slicer.example/v1/materials?token=sekret-token): fetch failed",
            ],
            ["VertexSlice error (503)", `VertexSlice error (503): ${SECRET}`],
        ];
        for (const [expected, raw] of cases) {
            const pub = publicProductionError(new Error(raw));
            expect(pub).toBe(expected);
            expectRedacted(pub);
        }
        expect(publicProductionError(new Error(`patient Jane Doe loft exploded ${SECRET}`))).toBe(
            "Manufacturing failed",
        );
    });

    test("a storage failure records error.name and a redacted public message", async () => {
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(
            store,
            insert("left", "storage-error"),
            new Date("2026-11-09T00:00:00.000Z"),
        );
        const failure = new Error(`Storage upload failed: ${SECRET}`);
        failure.name = "StorageError";
        const logged = capture("error");
        const warned = capture("warn");
        try {
            await executeCadOperatorProduction({
                row: (await store.findById(claimed.row.id)) ?? claimed.row,
                store,
                now: () => new Date("2026-11-09T00:00:01.000Z"),
                materialize: async () => {
                    throw failure;
                },
                slice: async () => ({ gcode: "G1\n", jobId: "job" }),
                uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
                charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
            });
        } finally {
            logged.restore();
            warned.restore();
        }
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("failed");
        expect(row?.error).toBe("Storage upload failed");
        expectRedacted(row?.error ?? "");
        const text = [...logged.lines, ...warned.lines].join("\n");
        expect(text).toContain("StorageError");
        expect(text).toContain("Storage upload failed");
        expectRedacted(text);
    });

    test("a VertexSlice failure records error.name and the status code", async () => {
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(
            store,
            insert("left", "slice-error"),
            new Date("2026-11-09T00:00:00.000Z"),
        );
        const failure = new Error(`VertexSlice error (503): ${SECRET}`);
        failure.name = "TRPCError";
        const logged = capture("error");
        try {
            await executeCadOperatorProduction({
                row: (await store.findById(claimed.row.id)) ?? claimed.row,
                store,
                now: () => new Date("2026-11-09T00:00:01.000Z"),
                materialize: async () => ({ stlStorageKey: "tmp/a.stl", meshFingerprint: null }),
                slice: async () => {
                    throw failure;
                },
                uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
                charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
            });
        } finally {
            logged.restore();
        }
        const row = await store.findById(claimed.row.id);
        expect(row?.error).toBe("VertexSlice error (503)");
        expectRedacted(row?.error ?? "");
        expect(logged.lines.join("\n")).toContain("TRPCError");
        expectRedacted(logged.lines.join("\n"));
    });
});

describe("transient manufacturing io retry", () => {
    test("classifies network and 5xx as transient and refuses geometry and 4xx", () => {
        expect(isTransientStorageOrNetworkError(new Error("Storage upload failed: fetch failed"))).toBe(true);
        expect(isTransientStorageOrNetworkError(new Error("Signed URL failed: socket hang up"))).toBe(true);
        expect(isTransientStorageOrNetworkError(new Error("Could not reach VertexSlice: ENOTFOUND"))).toBe(
            true,
        );
        expect(isTransientStorageOrNetworkError(new Error("VertexSlice error (503): bad gateway"))).toBe(
            true,
        );
        expect(isTransientStorageOrNetworkError(new Error("VertexSlice error (429): slow"))).toBe(true);
        expect(
            isTransientStorageOrNetworkError(new Error("Could not download manufacturing STL (404): no")),
        ).toBe(false);
        expect(isTransientStorageOrNetworkError(new Error("VertexSlice error (400): bad mesh"))).toBe(false);
        expect(isTransientStorageOrNetworkError(new Error("VertexSlice error (401): no"))).toBe(false);
        expect(
            isTransientStorageOrNetworkError(
                new Error("Canonical Export mesh is not available headless (Jane Doe)"),
            ),
        ).toBe(false);
        expect(isTransientStorageOrNetworkError(new Error("patient Jane Doe loft exploded"))).toBe(false);
        expect(
            isTransientStorageOrNetworkError(new Error("Material apex_light not available on slicer")),
        ).toBe(false);
        expect(
            isTransientStorageOrNetworkError(new Error("Storage upload failed: The resource already exists")),
        ).toBe(false);
    });

    test("a successful upload retry charges once and a second failure does not charge or try again", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-09T00:00:00.000Z");
        const success = await claimProduction(store, insert("left", "retry-ok"), now);
        let uploads = 0;
        let charges = 0;
        const slept: number[] = [];
        const warned = capture("warn");
        try {
            await executeCadOperatorProduction({
                row: (await store.findById(success.row.id)) ?? success.row,
                store,
                now: () => new Date("2026-11-09T00:00:02.000Z"),
                materialize: async () => ({ stlStorageKey: "tmp/a.stl", meshFingerprint: null }),
                slice: async () => ({ gcode: "G1 X0\n", jobId: "job-once" }),
                uploadGcode: () =>
                    withOneTransientRetry(
                        async () => {
                            uploads += 1;
                            if (uploads === 1)
                                throw new Error(`Storage upload failed: fetch failed ${SECRET}`);
                            return { storageKey: "gcode/cad-operator/t/c/d/left.gcode" };
                        },
                        {
                            sleep: async (ms) => {
                                slept.push(ms);
                            },
                            opName: "gcode-upload",
                        },
                    ),
                charge: async () => {
                    charges += 1;
                    return { exportId: "exp-1", balance: 4, alreadyCharged: false };
                },
            });
        } finally {
            warned.restore();
        }
        expect(uploads).toBe(2);
        expect(slept).toEqual([TRANSIENT_IO_BACKOFF_MS]);
        expect(charges).toBe(1);
        expect((await store.findById(success.row.id))?.status).toBe("succeeded");
        expectRedacted(warned.lines.join("\n"));

        const failed = await claimProduction(store, insert("right", "retry-fail"), now);
        let attempts = 0;
        let failedCharges = 0;
        await executeCadOperatorProduction({
            row: (await store.findById(failed.row.id)) ?? failed.row,
            store,
            now: () => new Date("2026-11-09T00:00:03.000Z"),
            materialize: async () => ({ stlStorageKey: "tmp/b.stl", meshFingerprint: null }),
            slice: async () => ({ gcode: "G1 X0\n", jobId: "job-fail" }),
            uploadGcode: () =>
                withOneTransientRetry(
                    async () => {
                        attempts += 1;
                        throw new Error("Storage upload failed: timeout");
                    },
                    { sleep: async () => undefined, opName: "gcode-upload" },
                ),
            charge: async () => {
                failedCharges += 1;
                return { exportId: "exp-2", balance: 1, alreadyCharged: false };
            },
        });
        expect(attempts).toBe(2);
        expect(failedCharges).toBe(0);
        expect((await store.findById(failed.row.id))?.error).toBe("Storage upload failed");
    });

    test("signed URL and storage upload retry once through the storage client", async () => {
        let uploads = 0;
        let signs = 0;
        const supabase = {
            storage: {
                from() {
                    return {
                        async upload() {
                            uploads += 1;
                            if (uploads === 1) {
                                return { error: { message: `fetch failed ${SECRET}` } };
                            }
                            return { error: null };
                        },
                        async createSignedUrl() {
                            signs += 1;
                            if (signs === 1) return { data: null, error: { message: "socket hang up" } };
                            return {
                                data: { signedUrl: "https://files.example.test/a.stl?token=sekret-token" },
                                error: null,
                            };
                        },
                    };
                },
            },
        };
        const warned = capture("warn");
        try {
            const uploaded = await withOneTransientRetry(
                () =>
                    uploadAsset(
                        supabase as never,
                        "manufacturing-temp/a.stl",
                        Buffer.from("stl"),
                        "model/stl",
                    ),
                { sleep: async () => undefined, opName: "stl-upload" },
            );
            const signed = await withOneTransientRetry(
                () => signedDownloadUrl(supabase as never, "manufacturing-temp/a.stl", 60),
                { sleep: async () => undefined, opName: "signed-url" },
            );
            expect(uploaded.sizeBytes).toBe(3);
            expect(signed).toContain("token=sekret-token");
            expect(uploads).toBe(2);
            expect(signs).toBe(2);
            expectRedacted(warned.lines.join("\n"));
        } finally {
            warned.restore();
        }

        let rejected = 0;
        const once = {
            storage: {
                from() {
                    return {
                        async upload() {
                            rejected += 1;
                            return { error: { message: "The resource already exists" } };
                        },
                    };
                },
            },
        };
        await expect(
            withOneTransientRetry(
                () => uploadAsset(once as never, "manufacturing-temp/a.stl", Buffer.from("stl"), "model/stl"),
                { sleep: async () => undefined, opName: "stl-upload" },
            ),
        ).rejects.toThrow(/Storage upload failed: The resource already exists/);
        expect(rejected).toBe(1);
    });
});
