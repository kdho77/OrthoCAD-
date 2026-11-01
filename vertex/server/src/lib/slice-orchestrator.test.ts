// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { MemorySliceLedger, type SliceLedger } from "./slice-ledger";
import { executeSliceJob } from "./slice-orchestrator";
import { redactSecrets, sliceWithVertexSlice } from "./vertexslice-client";

const userId = "22222222-2222-4222-8222-222222222222";

function runtime(opts: {
    ledger: SliceLedger;
    slice: (stl: Uint8Array) => Promise<string>;
    onSlice?: () => void;
}) {
    const stored: string[] = [];
    return {
        stored,
        runtime: {
            ledger: opts.ledger,
            async loadStl() {
                return new Uint8Array([1, 2, 3]);
            },
            async slice(_job: unknown, stl: Uint8Array) {
                opts.onSlice?.();
                return opts.slice(stl);
            },
            async storeGcode(_job: unknown, gcode: string) {
                const key = `gcode/${stored.length}-${gcode.length}.gcode`;
                stored.push(key);
                return key;
            },
        },
    };
}

describe("slice orchestrator against a mocked VertexSlice", () => {
    test("success stores G-code and charges once", async () => {
        const ledger = new MemorySliceLedger();
        ledger.setBalance(userId, 2);
        const { job } = await ledger.insertQueued({
            userId,
            idempotencyKey: "99999999-9999-4999-8999-999999999999",
            profileId: "apex-belt-v2",
            material: "TPU 95A",
            stlStorageKey: "manufacturing-temp/x.stl",
        });
        const harness = runtime({
            ledger,
            slice: async () => "G1 X1 Y2\n",
        });
        const done = await executeSliceJob(job.id, harness.runtime);
        expect(done?.status).toBe("succeeded");
        expect(done?.charged).toBe(true);
        expect(done?.tokenCost).toBe(1);
        expect(harness.stored).toHaveLength(1);
        expect(await ledger.getBalance(userId)).toBe(1);
    });

    test("VertexSlice failure charges nothing", async () => {
        const ledger = new MemorySliceLedger();
        ledger.setBalance(userId, 2);
        const { job } = await ledger.insertQueued({
            userId,
            idempotencyKey: "88888888-8888-4888-8888-888888888888",
            profileId: "apex-v2-insole-95a",
            material: "apex_core",
            stlStorageKey: "manufacturing-temp/x.stl",
        });
        const done = await executeSliceJob(
            job.id,
            runtime({
                ledger,
                slice: async () => {
                    throw new Error("VertexSlice slice failed (500)");
                },
            }).runtime,
        );
        expect(done?.status).toBe("failed");
        expect(done?.charged).toBe(false);
        expect(await ledger.getBalance(userId)).toBe(2);
        expect(ledger.charges).toHaveLength(0);
    });

    test("two workers racing the same job slice and charge once", async () => {
        const ledger = new MemorySliceLedger();
        ledger.setBalance(userId, 6);
        const { job } = await ledger.insertQueued({
            userId,
            idempotencyKey: "77777777-7777-4777-8777-777777777777",
            profileId: "apex-belt-v2",
            material: "ApexCore",
            stlStorageKey: "manufacturing-temp/x.stl",
        });
        let calls = 0;
        const harness = runtime({
            ledger,
            slice: async () => {
                calls += 1;
                await new Promise((resolve) => setTimeout(resolve, 20));
                return "G1 X0\n";
            },
        });
        await Promise.all([
            executeSliceJob(job.id, harness.runtime),
            executeSliceJob(job.id, harness.runtime),
        ]);
        expect(calls).toBe(1);
        expect(ledger.charges).toHaveLength(1);
        expect(await ledger.getBalance(userId)).toBe(5);
    });

    test("mocked VertexSlice HTTP sends the API key only as a header and redacts it from errors", async () => {
        const apiKey = "vs_test_key_do_not_log";
        const previous = process.env.VERTEXSLICE_URL;
        process.env.VERTEXSLICE_URL = "https://vertexslice.test";
        try {
            let sawKeyHeader = false;
            let sawKeyInUrl = false;
            const gcode = await sliceWithVertexSlice(
                {
                    stl: new Uint8Array([0x73, 0x74, 0x6c]),
                    profileId: "apex-belt-v2",
                    material: "TPU 95A",
                    hardness: "Medium",
                    fileName: "model.stl",
                },
                {
                    apiKey,
                    fetch: async (input, init) => {
                        const url = String(input);
                        sawKeyInUrl = url.includes(apiKey);
                        const headers = new Headers(init?.headers);
                        sawKeyHeader = headers.get("X-API-Key") === apiKey;
                        const form = init?.body as FormData;
                        expect(form.get("profile_id")).toBe("apex-v2-insole-medium");
                        expect(form.get("material")).toBe("apex_core");
                        expect(form.get("belt_insole_place")).toBe("true");
                        expect(form.get("model")).toBeTruthy();
                        return new Response("G1 X10\n", { status: 200 });
                    },
                },
            );
            expect(gcode).toContain("G1 X10");
            expect(sawKeyHeader).toBe(true);
            expect(sawKeyInUrl).toBe(false);

            await expect(
                sliceWithVertexSlice(
                    { stl: new Uint8Array([1]), profileId: "apex-v2-insole-95a", material: "apex_core" },
                    {
                        apiKey,
                        fetch: async () => new Response(`rejected ${apiKey}`, { status: 500 }),
                    },
                ),
            ).rejects.toThrow(/VertexSlice slice failed \(500\)/);

            try {
                await sliceWithVertexSlice(
                    { stl: new Uint8Array([1]), profileId: "apex-v2-insole-95a", material: "apex_light" },
                    {
                        apiKey,
                        fetch: async () => new Response(`rejected ${apiKey}`, { status: 401 }),
                    },
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : "";
                expect(message).not.toContain(apiKey);
                expect(message).toContain("[redacted]");
            }
        } finally {
            if (previous === undefined) delete process.env.VERTEXSLICE_URL;
            else process.env.VERTEXSLICE_URL = previous;
        }
    });

    test("redactSecrets strips the key even when it is repeated", () => {
        expect(redactSecrets("k and k", ["k"])).toBe("[redacted] and [redacted]");
    });
});
