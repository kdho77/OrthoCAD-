import { describe, expect, test } from "@rstest/core";

import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import {
    createDogfoodSavedDesign,
    type DogfoodSavedDesignStore,
} from "./dogfood-saved-design.js";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function store(existing: { designId: string } | null = null): DogfoodSavedDesignStore & {
    inserted: Array<Parameters<DogfoodSavedDesignStore["insert"]>[0]>;
} {
    const inserted: Array<Parameters<DogfoodSavedDesignStore["insert"]>[0]> = [];
    return {
        inserted,
        async findExisting() {
            return existing;
        },
        async findClient(id) {
            if (id !== clientId) return null;
            return { id, ownerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
        },
        async insert(input) {
            inserted.push(input);
        },
    };
}

describe("create dogfood saved design", () => {
    test("a new order stores SAMPLE_Top, defaulted medium width, and no scan", async () => {
        const db = store();
        const result = await createDogfoodSavedDesign({
            principal,
            externalOrderId: "order-dogfood",
            clientId,
            catalog: { shoe_size: { system: "US_M", size: 10 } },
            store: db,
            buildSnapshot: buildSavedDesignSnapshot,
            persist: async () => {
                throw new Error("persist is only for an existing design");
            },
        });
        expect(result.created).toBe(true);
        expect(result.template).toBe("SAMPLE_Top");
        expect(result.scans_used).toBe(false);
        expect(result.shoe_width).toBe("medium");
        expect(result.shoe_width_source).toBe("defaulted");
        expect(result.hardness_source).toBe("unspecified");
        expect(db.inserted).toHaveLength(1);
        expect(db.inserted[0]?.linkShoeWidth).toBe("");
        expect(db.inserted[0]?.shoeSize).toBe(10);
        const settings = readStoredDesignSettings(db.inserted[0]?.settingsJson);
        expect(settings?.base).toMatchObject({ assetId: "sample-top" });
        expect(settings?.shoeWidth).toBe("medium");
        expect(db.inserted[0]).not.toHaveProperty("scans");
        expect(JSON.stringify(settings)).not.toMatch(/"stl"/);
    });

    test("the same order refreshes the existing design instead of creating another", async () => {
        const db = store({ designId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
        const persisted: string[] = [];
        const result = await createDogfoodSavedDesign({
            principal,
            externalOrderId: "order-dogfood",
            clientId,
            catalog: { shoe_size: { system: "US_M", size: 10 }, width: "wide", hardness: "Hard" },
            store: db,
            persist: async (designId) => {
                persisted.push(designId);
                return {
                    ok: true,
                    design_id: designId,
                    ignored_fields: [],
                    unmapped_fields: [],
                    paths: [],
                    settingsJson: {},
                    template: "SAMPLE_Top",
                    scans_used: false,
                    shoe_width: "wide",
                    shoe_width_source: "prescribed",
                    hardness: "Hard",
                    hardness_source: "prescribed",
                };
            },
        });
        expect(result.created).toBe(false);
        expect(result.design_id).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
        expect(persisted).toEqual(["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]);
        expect(db.inserted).toEqual([]);
        expect(result.shoe_width_source).toBe("prescribed");
    });

    test("a missing shoe size asks instead of inventing one", async () => {
        const db = store();
        await expect(
            createDogfoodSavedDesign({
                principal,
                externalOrderId: "order-dogfood",
                clientId,
                catalog: {},
                store: db,
                buildSnapshot: buildSavedDesignSnapshot,
                persist: async () => {
                    throw new Error("unused");
                },
            }),
        ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/shoe size/) });
        expect(db.inserted).toEqual([]);
    });
});
