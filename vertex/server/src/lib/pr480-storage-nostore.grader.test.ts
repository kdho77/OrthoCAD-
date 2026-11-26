// Independent grader for PR #480 @ b7494709. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, test } from "@rstest/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
    downloadVoAttachFilesForAttempt,
    VO_ATTACH_MAX_ATTEMPTS,
} from "../../../../packages/mcp/src/payload/vo-attach-files.js";
import {
    cleanupManufacturingTempObjects,
    discardManufacturingTempStl,
    MANUFACTURING_SWEEP_MAX_AGE_HOURS,
    storedManufacturingListPlan,
} from "./manufacturing-stl-lifecycle.js";
import { buildManufacturingTempStlKey, MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC } from "./storage.js";

const PR480_HEAD = "b7494709b24b0e030b0eba614453d636dade759d";
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

/** Files in GitHub PR #480 diff (independent list; do not trust worker claims). */
const PR480_CHANGED_FILES = [
    "ci/unit-test-shards.json",
    "packages/mcp/src/clients/manufacturing-client.ts",
    "packages/mcp/src/payload/vo-attach-files.ts",
    "packages/mcp/src/tools/handlers.ts",
    "packages/mcp/src/tools/schemas.ts",
    "packages/mcp/test/vo-attach-download.test.ts",
    "vertex/scripts/cleanup-manufacturing-temp.ts",
    "vertex/scripts/list-stored-manufacturing-files.ts",
    "vertex/server/src/lib/cad-operator-production.ts",
    "vertex/server/src/lib/manufacturing-stl-download.ts",
    "vertex/server/src/lib/manufacturing-stl-lifecycle.test.ts",
    "vertex/server/src/lib/manufacturing-stl-lifecycle.ts",
    "vertex/server/src/lib/storage.ts",
    "vertex/server/src/orthocad-mcp.bundled.mjs",
    "vertex/server/src/routers/cad-operator-generate.ts",
    "vertex/server/src/routers/manufacturing-session.test.ts",
    "vertex/server/src/routers/manufacturing-session.ts",
    "vertex/server/src/routers/manufacturing.ts",
    "vertex/src/features/exports/export-service.ts",
    "vertex/src/features/exports/gcode-signed-download.test.ts",
] as const;

const FIXTURE_GCODE = gunzipSync(
    readFileSync(resolve(REPO_ROOT, "tests/fixtures/handedness/true_left_toe_first.gcode.gz")),
).toString("utf8");

const forbiddenScope =
    /(^tests\/(?!fixtures\/handedness\/)|\/geometry\/|procedural-wall|\/loft\/|slicer|vertexslice|one-click-baseline|sink-preview-gate)/i;

describe("PR #480 grader — measurable gates", () => {
    test("G0: graded SHA and PR touch only the declared 20 paths", () => {
        expect(PR480_HEAD).toMatch(/^b7494709/);
        expect(PR480_CHANGED_FILES.length).toBe(20);
        for (const file of PR480_CHANGED_FILES) {
            expect(file).not.toMatch(forbiddenScope);
            expect(readFileSync(join(REPO_ROOT, file), "utf8").length).toBeGreaterThan(0);
        }
    });

    test("G1: archive copy and sourceStlPath writes are gone from production routers", () => {
        for (const rel of [
            "vertex/server/src/routers/cad-operator-generate.ts",
            "vertex/server/src/routers/manufacturing.ts",
            "vertex/server/src/routers/manufacturing-session.ts",
            "vertex/server/src/lib/cad-operator-production.ts",
        ]) {
            const source = readFileSync(join(REPO_ROOT, rel), "utf8");
            expect(source).not.toContain("archiveManufacturingSourceStl");
            expect(source).not.toContain("archiveTemp:");
            expect(source).not.toContain("archiveSourceStl");
            expect(source).not.toMatch(/sourceStlPath\s*:/);
        }
        const lifecycle = readFileSync(
            join(REPO_ROOT, "vertex/server/src/lib/manufacturing-stl-lifecycle.ts"),
            "utf8",
        );
        expect(lifecycle).not.toContain("archiveManufacturingSourceStl");
        expect(lifecycle).toContain("discardManufacturingTempStl");
    });

    test("G2: temp STL delete is independent of archive table updates", async () => {
        const userId = "11111111-1111-4111-8111-111111111111";
        const tempKey = buildManufacturingTempStlKey(userId, 99, "22222222-2222-4222-8222-222222222222");
        const objects: Array<{ key: string }> = [{ key: tempKey }];
        const updates: unknown[] = [];
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
                        remove: async (keys: string[]) => {
                            for (const key of keys) {
                                const i = objects.findIndex((o) => o.key === key);
                                if (i >= 0) objects.splice(i, 1);
                            }
                            return { error: null };
                        },
                    };
                },
            },
        } as unknown as SupabaseClient;
        await discardManufacturingTempStl(client, tempKey);
        expect(objects).toHaveLength(0);
        expect(JSON.stringify(updates)).not.toContain("sourceStlPath");
        expect(updates).toHaveLength(0);
    });

    test("G3: sweep age is capped at 24h and cleanup script documents host cron", () => {
        expect(MANUFACTURING_SWEEP_MAX_AGE_HOURS).toBe(24);
        const script = readFileSync(join(REPO_ROOT, "vertex/scripts/cleanup-manufacturing-temp.ts"), "utf8");
        expect(script).toContain("gcode/");
        expect(script).toContain("0 9 * * *");
        expect(script).toContain("manufacturing-archive/` is not touched");
    });

    test("G4: list script plan never deletes even with --confirm", () => {
        expect(storedManufacturingListPlan(["--confirm"]).deletes).toBe(false);
        const listScript = readFileSync(
            join(REPO_ROOT, "vertex/scripts/list-stored-manufacturing-files.ts"),
            "utf8",
        );
        expect(listScript).toContain("never deletes");
        expect(listScript).not.toMatch(/deleteAsset|\.remove\(/);
    });

    test("G5: attach attempt fetches each URL once; max attempts is 3", async () => {
        expect(VO_ATTACH_MAX_ATTEMPTS).toBe(3);
        const hits: string[] = [];
        const fetchImpl = (async (url: string | URL | Request) => {
            hits.push(String(url));
            return new Response("bytes", { status: 200 });
        }) as typeof fetch;
        await downloadVoAttachFilesForAttempt({
            files: [
                { download_url: "https://files.example.test/a.gcode" },
                { download_url: "https://files.example.test/a.gcode" },
                { content_base64: Buffer.from("inline").toString("base64") },
            ],
            attempt: 1,
            fetchImpl,
        });
        expect(hits).toEqual(["https://files.example.test/a.gcode"]);
    });

    test("G6: signed download TTL is one hour and fixture G-code bytes are stable", () => {
        expect(MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC).toBe(3600);
        expect(FIXTURE_GCODE.length).toBeGreaterThan(1000);
        expect(FIXTURE_GCODE).toMatch(/^;.*\n/);
    });

    test("G7: 24h sweep removes stale gcode but not manufacturing-archive", async () => {
        const now = Date.parse("2026-11-26T12:00:00.000Z");
        const archive = "manufacturing-archive/user/old.stl";
        const staleGcode = "gcode/design/old.gcode";
        const objects: Array<{ key: string; created_at?: string }> = [
            { key: archive, created_at: new Date(now - 200 * 3_600_000).toISOString() },
            {
                key: staleGcode,
                created_at: new Date(now - 25 * 3_600_000).toISOString(),
            },
        ];
        const client = {
            storage: {
                from() {
                    return {
                        list: async (prefix: string) => {
                            const normalized = prefix.replace(/\/$/, "");
                            const rows = objects.filter((o) => o.key.startsWith(`${normalized}/`));
                            return {
                                data: rows.map((o) => {
                                    const name = o.key.slice(normalized.length + 1);
                                    return { name, id: o.key, created_at: o.created_at };
                                }),
                                error: null,
                            };
                        },
                        remove: async (keys: string[]) => {
                            for (const key of keys) {
                                const i = objects.findIndex((o) => o.key === key);
                                if (i >= 0) objects.splice(i, 1);
                            }
                            return { error: null };
                        },
                    };
                },
            },
        } as unknown as SupabaseClient;
        const summary = await cleanupManufacturingTempObjects(client, 24, "vertex-manufacturing", now);
        expect(summary.deleted).toBe(1);
        expect(objects.map((o) => o.key)).toEqual([archive]);
    });
});
