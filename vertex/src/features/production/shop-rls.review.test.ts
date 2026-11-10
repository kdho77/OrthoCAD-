// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// The isolated Postgres harness includes only the dogfood acceptance file, so
// this check is static: Prisma is the only server path, and the review SQL is
// not a migration.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";

const ROOTS = ["vertex/src", "vertex/server/src", "vertex/shared", "vertex/api", "vertex/print-bridge"];
const TABLES =
    "shop_printers|shop_jobs|job_gcode|shop_bridges|shop_enrollments|shop_printer_configs|shop_dispatch_records|shop_dispatch_events";
const TABLE_PATTERN = new RegExp(`\\b(${TABLES})\\b`);
const FROM_PATTERN = new RegExp(`\\.from\\(\\s*["'\`](${TABLES})["'\`]`);
function importsSupabase(source: string): boolean {
    return source.split("\n").some((line) => {
        const code = line.replace(/\/\/.*$/, "");
        return /from\s+["'][^"']*supabase[^"']*["']/.test(code);
    });
}

function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) files(path, out);
        else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(path);
    }
    return out;
}

describe("shop row level security review", () => {
    test("the review SQL enables RLS without policies and is not a migration", () => {
        const path = "vertex/src/features/production/shop-rls.review.sql";
        expect(path.includes("prisma/migrations")).toBe(false);
        const sql = readFileSync(path, "utf8");
        expect(sql).toContain("vertex/prisma/migrations/20261101170000_production_jobs");
        expect(sql).toContain("dispatch-ledger.review.sql");
        expect(sql).toContain("print-bridge.review.sql");
        expect(sql).toContain(
            "shop_printer_configs, shop_dispatch_records, shop_dispatch_events, shop_bridges, shop_enrollments",
        );
        expect(sql).toContain('ALTER TABLE "shop_printers" ENABLE ROW LEVEL SECURITY;');
        expect(sql).toContain('ALTER TABLE "shop_jobs" ENABLE ROW LEVEL SECURITY;');
        expect(sql).toContain('ALTER TABLE "job_gcode" ENABLE ROW LEVEL SECURITY;');
        expect(sql).toContain('ALTER TABLE "shop_printers" DISABLE ROW LEVEL SECURITY;');
        expect(sql).toContain('ALTER TABLE "shop_jobs" DISABLE ROW LEVEL SECURITY;');
        expect(sql).toContain('ALTER TABLE "job_gcode" DISABLE ROW LEVEL SECURITY;');
        expect(sql).not.toMatch(/CREATE POLICY/i);
        expect(sql).not.toMatch(/DROP TABLE/i);
        expect(sql).toContain("DO NOT copy it into vertex/prisma/migrations");
    });

    test("no supabase client reads or writes shop tables or job_gcode", () => {
        const offenders: string[] = [];
        for (const path of ROOTS.flatMap((root) => files(root))) {
            const source = readFileSync(path, "utf8");
            if (FROM_PATTERN.test(source)) offenders.push(`${path} uses a client .from() table call`);
            if (importsSupabase(source) && TABLE_PATTERN.test(source)) {
                offenders.push(`${path} imports supabase and names a shop table`);
            }
        }
        expect(offenders).toEqual([]);
        const repo = readFileSync("vertex/server/src/lib/prisma-production-repo.ts", "utf8");
        const directory = readFileSync("vertex/server/src/lib/prisma-bridge-directory.ts", "utf8");
        expect(repo).not.toContain("@supabase/supabase-js");
        expect(directory).not.toContain("@supabase/supabase-js");
        expect(repo).toContain("shopPrinter");
        expect(repo).toContain("shopJob");
        expect(repo).toContain("jobGcode");
        expect(directory).toContain("shopBridge");
        expect(directory).toContain("shopEnrollment");
    });
});
