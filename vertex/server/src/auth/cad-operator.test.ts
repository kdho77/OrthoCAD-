// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    assertCadOperatorGcodeKey,
    assertCadOperatorTempStlKey,
    buildCadOperatorGcodeKey,
    buildCadOperatorTempStlKey,
    CAD_OPERATOR_SCOPES,
    DOGFOOD_TENANT_ID,
    principalFromCredential,
    resolveCadOperatorFromAuthorization,
} from "./cad-operator.js";
import { generateIntegrationKey, hashIntegrationKey } from "./integration-keys.js";

const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

describe("dogfood CAD-operator credential", () => {
    test("dogfood membership yields only read, generate, and download scopes", () => {
        const principal = principalFromCredential({
            id: "cred-1",
            revokedAt: null,
            tenantIds: [DOGFOOD_TENANT_ID, OTHER_TENANT],
        });
        expect(principal?.tenantId).toBe(DOGFOOD_TENANT_ID);
        expect(principal?.scopes).toEqual(CAD_OPERATOR_SCOPES);
        expect(principal?.scopes).not.toContain("admin");
        expect(principal?.scopes.join(" ")).not.toMatch(/order|upload|write|stl/);
    });

    test("revoked and non-dogfood keys do not become a principal", async () => {
        expect(
            principalFromCredential({
                id: "cred",
                revokedAt: "2026-11-01T00:00:00.000Z",
                tenantIds: [DOGFOOD_TENANT_ID],
            }),
        ).toBeNull();
        expect(
            principalFromCredential({ id: "cred", revokedAt: null, tenantIds: [OTHER_TENANT] }),
        ).toBeNull();

        const { token, hash } = generateIntegrationKey();
        const resolved = await resolveCadOperatorFromAuthorization(`Bearer ${token}`, async (got) => {
            expect(got).toBe(hash);
            expect(got).not.toBe(token);
            return { id: "cred", revokedAt: null, tenantIds: [OTHER_TENANT] };
        });
        expect(resolved).toBeNull();
        const missing = await resolveCadOperatorFromAuthorization(`Bearer ${token}`, async () => null);
        expect(missing).toBeNull();
    });

    test("session JWTs and dev bearers are not integration keys", async () => {
        const lookup = async () => {
            throw new Error("lookup should not run");
        };
        expect(
            await resolveCadOperatorFromAuthorization(
                "Bearer dev:00000000-0000-4000-8000-000000000001",
                lookup,
            ),
        ).toBeNull();
        expect(
            await resolveCadOperatorFromAuthorization("Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig", lookup),
        ).toBeNull();
    });

    test("storage and gcode keys fail closed across credentials", () => {
        const own = buildCadOperatorTempStlKey("cred-a", 1, "11111111-1111-4111-8111-111111111111");
        expect(() => assertCadOperatorTempStlKey(own, "cred-a")).not.toThrow();
        expect(() => assertCadOperatorTempStlKey(own, "cred-b")).toThrow(/Invalid manufacturing STL/);
        expect(() => assertCadOperatorTempStlKey("manufacturing-temp/user-1/1-file.stl", "cred-a")).toThrow(
            /Invalid manufacturing STL/,
        );
        const gcode = buildCadOperatorGcodeKey(
            "cred-a",
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "left.gcode",
        );
        expect(gcode.startsWith(`gcode/cad-operator/${DOGFOOD_TENANT_ID}/cred-a/`)).toBe(true);
        expect(() => assertCadOperatorGcodeKey(gcode, "cred-b")).toThrow(/Invalid G-code/);
        expect(() => assertCadOperatorGcodeKey("gcode/design/file.gcode", "cred-a")).toThrow(
            /Invalid G-code/,
        );
        expect(own.includes(hashIntegrationKey("ocad_secret"))).toBe(false);
    });
});
