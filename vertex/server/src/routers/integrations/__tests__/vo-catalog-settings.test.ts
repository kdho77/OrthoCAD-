// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import { issueIntegrationCredential } from "../../../auth/integration-keys.js";
import { createIntegrationHandler } from "../http.js";
import { createMemoryIntegrationStore } from "../memory-store.js";
import type { IntegrationDeps } from "../service.js";
import {
    mapVoCatalogToSettings,
    UNMAPPED_VO_FIELDS,
    usMenSizeFromVoShoe,
    VoCatalogConflictError,
} from "../vo-catalog-settings.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const INVENTED = [
    "corrections",
    "archHeightMm",
    "printRecipe",
    "elements",
    "mortons",
    "met_pad",
    "hardness",
    "footLengthMm",
    "shoeType",
    "material",
];

function assertNotInvented(settings: Record<string, unknown> | null): void {
    const blob = JSON.stringify(settings);
    for (const word of INVENTED) expect(blob).not.toContain(word);
}

describe("VO catalog to settingsJson", () => {
    test("named size and width land on the saved-design paths", () => {
        const settings = mapVoCatalogToSettings({
            shoeSize: null,
            shoeSizeLeft: null,
            shoeSizeRight: null,
            width: null,
            catalog: {
                shoe_size: { system: "US_M", size: 10.5 },
                width: "wide",
                arch_height_mm: 6,
                hardness: "Extra Hard",
                material: "EVA",
                length_mm: 270,
                shoe_type: "athletic",
                side: "left",
                mortons_extension_mm: 4,
                met_pad: true,
            },
        });
        expect(settings).toEqual({ sizeSystem: "us", usMenSize: 10.5, shoeWidth: "wide" });
        assertNotInvented(settings);
    });

    test("US women's size uses the documented +1.5 offset and does not clamp", () => {
        expect(usMenSizeFromVoShoe("US_W", 10)).toBe(8.5);
        const settings = mapVoCatalogToSettings({
            shoeSize: { system: "US_W", size: 10 },
            shoeSizeLeft: null,
            shoeSizeRight: null,
            width: null,
            catalog: null,
        });
        expect(settings).toEqual({ sizeSystem: "us", usMenSize: 8.5 });
        expect(usMenSizeFromVoShoe("US_W", 1)).toBeNull();
        expect(usMenSizeFromVoShoe("US_M", 10.2)).toBeNull();
        expect(usMenSizeFromVoShoe("US_M", 18)).toBeNull();
        expect(usMenSizeFromVoShoe("EU", 42)).toBeNull();
    });

    test("null, EU, and disagreeing lengths are omitted", () => {
        expect(
            mapVoCatalogToSettings({
                shoeSize: { system: "US_M", size: 10 },
                shoeSizeLeft: null,
                shoeSizeRight: null,
                width: null,
                catalog: { width: null, arch_height_mm: null },
            }),
        ).toEqual({ sizeSystem: "us", usMenSize: 10 });

        expect(
            mapVoCatalogToSettings({
                shoeSize: { system: "EU", size: 42 },
                shoeSizeLeft: null,
                shoeSizeRight: null,
                width: "narrow",
                catalog: null,
            }),
        ).toEqual({ shoeWidth: "narrow" });

        expect(
            mapVoCatalogToSettings({
                shoeSize: { system: "US_M", size: 10 },
                shoeSizeLeft: 9,
                shoeSizeRight: 11,
                width: "medium",
                catalog: null,
            }),
        ).toEqual({ shoeWidth: "medium" });

        expect(
            mapVoCatalogToSettings({
                shoeSize: null,
                shoeSizeLeft: null,
                shoeSizeRight: null,
                width: null,
                catalog: null,
            }),
        ).toBeNull();
    });

    test("equal left and right overrides replace the single size", () => {
        expect(
            mapVoCatalogToSettings({
                shoeSize: { system: "US_M", size: 12 },
                shoeSizeLeft: 10,
                shoeSizeRight: 10,
                width: null,
                catalog: null,
            }),
        ).toEqual({ sizeSystem: "us", usMenSize: 10 });
    });

    test("a catalog value that disagrees with the order is rejected", () => {
        expect(() =>
            mapVoCatalogToSettings({
                shoeSize: { system: "US_M", size: 10 },
                shoeSizeLeft: null,
                shoeSizeRight: null,
                width: "wide",
                catalog: { shoe_size: { system: "US_M", size: 11 }, width: "narrow" },
            }),
        ).toThrow(VoCatalogConflictError);
    });

    test("unmapped list records rx text, EU, and corrections", () => {
        const keys = UNMAPPED_VO_FIELDS.map((row) => row.key).join(" ");
        expect(keys).toContain("rx_text");
        expect(keys).toContain("shoe_size.system=EU");
        expect(keys).toContain("hardness");
    });
});

describe("POST /api/integrations/v1/designs persists mapped settings", () => {
    test("structured catalog is stored and free text is not parsed", async () => {
        const store = createMemoryIntegrationStore();
        store.addTenant({ id: TENANT, name: "Fixture clinic" });
        store.addUser({ id: USER, tenantId: TENANT, role: "clinician", email: "fixture@example.test" });
        const deps: IntegrationDeps = {
            store,
            now: () => new Date("2026-11-06T00:00:00.000Z"),
            uploadSigningKey: "test-upload-signing-key",
            uploadBaseUrl: "https://uploads.example.test/put",
            appOrigin: "https://app.example.test",
        };
        const handler = createIntegrationHandler(deps);
        const key = await issueIntegrationCredential(store, { label: "fixture", tenantIds: [TENANT] });
        const post = (path: string, body: unknown) =>
            handler(
                new Request(`https://api.example.test${path}`, {
                    method: "POST",
                    headers: { authorization: `Bearer ${key.apiKey}`, "content-type": "application/json" },
                    body: JSON.stringify(body),
                }),
            );

        const client = (await (
            await post("/api/integrations/v1/clients/upsert", {
                source: "vo2",
                external_client_id: "fixture-client",
                tenant_id: TENANT,
                first_name: "Fixture",
                last_name: "Chart",
                shoe_size: { system: "US_M", size: 9 },
            })
        ).json()) as { client_id: string };

        const rxText = "arch 6 mm, Morton's extension, met pad, hardness Extra Hard";
        const created = (await (
            await post("/api/integrations/v1/designs", {
                source: "vo2",
                tenant_id: TENANT,
                client_id: client.client_id,
                external_order_id: "fixture-order",
                type: "insole",
                sides: "left",
                rx_text: rxText,
                catalog: {
                    shoe_size: { system: "US_M", size: 11 },
                    width: "wide",
                    arch_height_mm: 6,
                    hardness: "Extra Hard",
                    mortons_extension_mm: 4,
                },
            })
        ).json()) as { design_id: string };

        const design = await store.getDesign(created.design_id);
        expect(design?.settingsJson).toEqual({
            schemaVersion: 1,
            settings: { sizeSystem: "us", usMenSize: 11, shoeWidth: "wide" },
        });
        assertNotInvented(design?.settingsJson?.settings ?? null);
        const link = await store.findDesignLink({
            source: "vo2",
            tenantId: TENANT,
            externalOrderId: "fixture-order",
        });
        expect(link?.rxText).toBe(rxText);
        expect(link?.shoe).toMatchObject({ system: "US_M", size: 11, width: "wide" });

        const bare = (await (
            await post("/api/integrations/v1/designs", {
                source: "vo2",
                tenant_id: TENANT,
                client_id: client.client_id,
                external_order_id: "fixture-order-blank",
                type: "insole",
                sides: "pair",
                rx_text: rxText,
            })
        ).json()) as { design_id: string };
        const blank = await store.getDesign(bare.design_id);
        expect(blank?.settingsJson).toBeNull();
        const blankLink = await store.findDesignLink({
            source: "vo2",
            tenantId: TENANT,
            externalOrderId: "fixture-order-blank",
        });
        expect(blankLink?.rxText).toBe(rxText);
        expect(blankLink?.shoe.size).toBe(9);
    });
});
