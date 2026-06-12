// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    buildPostgresUrl,
    extractSupabaseProjectRef,
    isInvalidSupabaseHost,
    normalizeSupabaseDatabaseUrl,
    parsePostgresUrl,
    resolveDatabaseUrl,
    resolveDirectUrl,
    withPgbouncerParam,
} from "./prisma";

describe("extractSupabaseProjectRef", () => {
    test("extracts ref from SUPABASE_URL", () => {
        expect(extractSupabaseProjectRef("https://wstneucimlemaokoyjwh.supabase.co")).toBe(
            "wstneucimlemaokoyjwh",
        );
    });
});

describe("isInvalidSupabaseHost", () => {
    test("flags bare postgres.{ref} hostnames", () => {
        expect(isInvalidSupabaseHost("postgres.wstneucimlemaokoyjwh")).toBe(true);
        expect(isInvalidSupabaseHost("db.wstneucimlemaokoyjwh.supabase.co")).toBe(false);
        expect(isInvalidSupabaseHost("aws-0-us-east-1.pooler.supabase.com")).toBe(false);
    });
});

describe("normalizeSupabaseDatabaseUrl", () => {
    test("rewrites invalid postgres.{ref} host to db.{ref}.supabase.co", () => {
        const raw =
            "postgresql://postgres.wstneucimlemaokoyjwh:secret@postgres.wstneucimlemaokoyjwh:6543/postgres";
        const fixed = normalizeSupabaseDatabaseUrl(raw, {
            projectRef: "wstneucimlemaokoyjwh",
            pooled: false,
        });
        const parts = parsePostgresUrl(fixed);
        expect(parts?.host).toBe("db.wstneucimlemaokoyjwh.supabase.co");
        expect(parts?.port).toBe("5432");
        expect(parts?.user).toBe("postgres");
    });

    test("strips broken supa=base-pooler query params from Vercel integration URLs", () => {
        const raw =
            "postgresql://postgres.wstneucimlemaokoyjwh:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x";
        const fixed = normalizeSupabaseDatabaseUrl(raw, {
            projectRef: "wstneucimlemaokoyjwh",
            pooled: true,
        });
        expect(fixed).not.toContain("supa=base-pooler");
        expect(fixed).toContain("pgbouncer=true");
        expect(fixed).toContain("postgres.wstneucimlemaokoyjwh");
    });
});

describe("withPgbouncerParam", () => {
    test("appends pgbouncer=true when missing", () => {
        expect(withPgbouncerParam("postgresql://u:p@host/db")).toBe(
            "postgresql://u:p@host/db?pgbouncer=true",
        );
        expect(withPgbouncerParam("postgresql://u:p@host/db?schema=public")).toBe(
            "postgresql://u:p@host/db?schema=public&pgbouncer=true",
        );
    });

    test("does not duplicate pgbouncer=true", () => {
        const url = "postgresql://u:p@host/db?pgbouncer=true";
        expect(withPgbouncerParam(url)).toBe(url);
    });
});

describe("resolveDatabaseUrl", () => {
    test("prefers DATABASE_URL over Supabase fallbacks", () => {
        const prev = {
            DATABASE_URL: process.env.DATABASE_URL,
            POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
            POSTGRES_URL: process.env.POSTGRES_URL,
            SUPABASE_URL: process.env.SUPABASE_URL,
        };
        process.env.DATABASE_URL =
            "postgresql://postgres.wstneucimlemaokoyjwh:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
        process.env.POSTGRES_PRISMA_URL = "postgresql://prisma";
        process.env.POSTGRES_URL = "postgresql://postgres";
        process.env.SUPABASE_URL = "https://wstneucimlemaokoyjwh.supabase.co";
        expect(resolveDatabaseUrl()).toContain("aws-0-us-east-1.pooler.supabase.com");
        process.env.DATABASE_URL = prev.DATABASE_URL;
        process.env.POSTGRES_PRISMA_URL = prev.POSTGRES_PRISMA_URL;
        process.env.POSTGRES_URL = prev.POSTGRES_URL;
        process.env.SUPABASE_URL = prev.SUPABASE_URL;
    });

    test("falls back to direct db host when pooler URL has invalid hostname", () => {
        const prev = {
            DATABASE_URL: process.env.DATABASE_URL,
            POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
            POSTGRES_URL: process.env.POSTGRES_URL,
            DIRECT_URL: process.env.DIRECT_URL,
            POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
            POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
            SUPABASE_URL: process.env.SUPABASE_URL,
        };
        process.env.DATABASE_URL = undefined;
        process.env.POSTGRES_PRISMA_URL =
            "postgresql://postgres.wstneucimlemaokoyjwh:secret@postgres.wstneucimlemaokoyjwh:6543/postgres";
        process.env.POSTGRES_URL = process.env.POSTGRES_PRISMA_URL;
        process.env.DIRECT_URL = undefined;
        process.env.POSTGRES_URL_NON_POOLING = undefined;
        process.env.POSTGRES_PASSWORD = "secret";
        process.env.SUPABASE_URL = "https://wstneucimlemaokoyjwh.supabase.co";
        expect(resolveDatabaseUrl()).toBe(
            "postgresql://postgres:secret@db.wstneucimlemaokoyjwh.supabase.co:5432/postgres",
        );
        process.env.DATABASE_URL = prev.DATABASE_URL;
        process.env.POSTGRES_PRISMA_URL = prev.POSTGRES_PRISMA_URL;
        process.env.POSTGRES_URL = prev.POSTGRES_URL;
        process.env.DIRECT_URL = prev.DIRECT_URL;
        process.env.POSTGRES_URL_NON_POOLING = prev.POSTGRES_URL_NON_POOLING;
        process.env.POSTGRES_PASSWORD = prev.POSTGRES_PASSWORD;
        process.env.SUPABASE_URL = prev.SUPABASE_URL;
    });
});

describe("resolveDirectUrl", () => {
    test("prefers DIRECT_URL over POSTGRES_URL_NON_POOLING", () => {
        const prev = {
            DIRECT_URL: process.env.DIRECT_URL,
            POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
            SUPABASE_URL: process.env.SUPABASE_URL,
            POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
        };
        process.env.DIRECT_URL = "postgresql://postgres:secret@db.example.supabase.co:5432/postgres";
        process.env.POSTGRES_URL_NON_POOLING = "postgresql://postgres:secret@pool.example.supabase.co:5432/postgres";
        process.env.SUPABASE_URL = undefined;
        process.env.POSTGRES_PASSWORD = undefined;
        expect(resolveDirectUrl()).toBe(
            "postgresql://postgres:secret@db.example.supabase.co:5432/postgres",
        );
        process.env.DIRECT_URL = prev.DIRECT_URL;
        process.env.POSTGRES_URL_NON_POOLING = prev.POSTGRES_URL_NON_POOLING;
        process.env.SUPABASE_URL = prev.SUPABASE_URL;
        process.env.POSTGRES_PASSWORD = prev.POSTGRES_PASSWORD;
    });

    test("builds direct URL from SUPABASE_URL and POSTGRES_PASSWORD", () => {
        const prev = {
            DIRECT_URL: process.env.DIRECT_URL,
            POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
            POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
            SUPABASE_URL: process.env.SUPABASE_URL,
        };
        process.env.DIRECT_URL = undefined;
        process.env.POSTGRES_URL_NON_POOLING = undefined;
        process.env.POSTGRES_PASSWORD = "secret";
        process.env.SUPABASE_URL = "https://wstneucimlemaokoyjwh.supabase.co";
        expect(resolveDirectUrl()).toBe(
            "postgresql://postgres:secret@db.wstneucimlemaokoyjwh.supabase.co:5432/postgres",
        );
        process.env.DIRECT_URL = prev.DIRECT_URL;
        process.env.POSTGRES_URL_NON_POOLING = prev.POSTGRES_URL_NON_POOLING;
        process.env.POSTGRES_PASSWORD = prev.POSTGRES_PASSWORD;
        process.env.SUPABASE_URL = prev.SUPABASE_URL;
    });
});

describe("buildPostgresUrl + parsePostgresUrl", () => {
    test("round-trips a connection string", () => {
        const original = buildPostgresUrl({
            user: "postgres.wstneucimlemaokoyjwh",
            password: "p@ss:wrd",
            host: "aws-0-us-east-1.pooler.supabase.com",
            port: "6543",
            database: "postgres",
            search: "?sslmode=require",
        });
        const parsed = parsePostgresUrl(original);
        expect(parsed?.user).toBe("postgres.wstneucimlemaokoyjwh");
        expect(parsed?.password).toBe("p@ss:wrd");
        expect(parsed?.host).toBe("aws-0-us-east-1.pooler.supabase.com");
    });
});
