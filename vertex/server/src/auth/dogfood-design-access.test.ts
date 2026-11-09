// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";

import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "./cad-operator.js";
import {
    type DogfoodDesignSource,
    dogfoodDesignRead,
    publicDogfoodDesignRead,
} from "./dogfood-design-access.js";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

function row(patch: Partial<DogfoodDesignSource> = {}): DogfoodDesignSource {
    return {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Insole order-1",
        kind: "insole",
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 3,
        linked: true,
        unit: "mm",
        settingsJson: {
            schemaVersion: 1,
            settings: { thicknessMm: 3, vertices: [1, 2, 3], notes: "kept-in-settings" },
        },
        updatedAt: "2026-11-06T00:00:00.000Z",
        deletedAt: null,
        clientTenantId: DOGFOOD_TENANT_ID,
        linkTenantId: DOGFOOD_TENANT_ID,
        source: "vo2",
        externalOrderId: "order-1",
        sides: "pair",
        ...patch,
    };
}

describe("dogfood design read fails closed", () => {
    test("returns parameters without the owner id and strips mesh blobs", () => {
        const read = publicDogfoodDesignRead(dogfoodDesignRead(principal, row()));
        expect(read.tenantId).toBe(DOGFOOD_TENANT_ID);
        expect(read).not.toHaveProperty("ownerId");
        expect(read).not.toHaveProperty("notes");
        const settings = read.settingsJson as { settings: Record<string, unknown> };
        expect(settings.settings.thicknessMm).toBe(3);
        expect(settings.settings.vertices).toBeUndefined();
    });

    test("cross-tenant link, client, and deleted rows are not found", () => {
        const other = "22222222-2222-4222-8222-222222222222";
        for (const source of [
            null,
            row({ linkTenantId: other }),
            row({ clientTenantId: other }),
            row({ deletedAt: "2026-11-01T00:00:00.000Z" }),
            row({ linkTenantId: null }),
        ]) {
            expect(() => dogfoodDesignRead(principal, source)).toThrow(TRPCError);
        }
    });
});
