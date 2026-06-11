// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { resolveDatabaseUrl, resolveDirectUrl, withPgbouncerParam } from "./prisma";

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
        };
        process.env.DATABASE_URL = "postgresql://pooled";
        process.env.POSTGRES_PRISMA_URL = "postgresql://prisma";
        process.env.POSTGRES_URL = "postgresql://postgres";
        expect(resolveDatabaseUrl()).toBe("postgresql://pooled");
        process.env.DATABASE_URL = prev.DATABASE_URL;
        process.env.POSTGRES_PRISMA_URL = prev.POSTGRES_PRISMA_URL;
        process.env.POSTGRES_URL = prev.POSTGRES_URL;
    });
});

describe("resolveDirectUrl", () => {
    test("prefers DIRECT_URL over POSTGRES_URL_NON_POOLING", () => {
        const prev = {
            DIRECT_URL: process.env.DIRECT_URL,
            POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
        };
        process.env.DIRECT_URL = "postgresql://direct";
        process.env.POSTGRES_URL_NON_POOLING = "postgresql://non-pooling";
        expect(resolveDirectUrl()).toBe("postgresql://direct");
        process.env.DIRECT_URL = prev.DIRECT_URL;
        process.env.POSTGRES_URL_NON_POOLING = prev.POSTGRES_URL_NON_POOLING;
    });
});
