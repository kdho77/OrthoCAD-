// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import type { PrintRecipeV1 } from "../../../shared/print-recipe/print-recipe.js";
import { type CadGeneratePlan, materializeCadOperatorStl } from "./manufacturing-cad.js";

const recipe: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
    profileId: "apex-v2-insole-95a",
    defaultHardness: "Hard",
    zones: [],
};

function plan(patch: Partial<CadGeneratePlan>): CadGeneratePlan {
    return {
        stlStorageKey: null,
        presetId: "apex-v2-insole-95a",
        printRecipe: recipe,
        material: "apex_core",
        beltAngleDeg: 45,
        ownerId: "owner-1",
        useSavedDesignMesh: true,
        settingsJson: { schemaVersion: 1, firstName: "Jane Doe", settingsJson: { thicknessMm: 3 } },
        ...patch,
    };
}

describe("CAD-operator STL materialize logs", () => {
    test("materialize done includes STL bytes and upload complete does not include PHI", async () => {
        const lines: string[] = [];
        const original = console.log;
        console.log = (...args: unknown[]) => {
            lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
        };
        let uploaded = 0;
        try {
            const result = await materializeCadOperatorStl({
                plan: plan({}),
                credentialId: "cred-1",
                side: "left",
                uploadStl: async (_key, bytes) => {
                    uploaded += 1;
                    expect(bytes.length).toBe(4);
                },
                buildFoot: async () => ({
                    side: "left",
                    stl: new Uint8Array([1, 2, 3, 4]).buffer,
                    solidTriangles: 1,
                    uploadTriangles: 1,
                    fingerprint: "mesh",
                }),
            });
            expect(result.meshFingerprint).toBe("mesh");
            expect(result.stlStorageKey).toContain("cred-1");
        } finally {
            console.log = original;
        }
        expect(uploaded).toBe(1);
        expect(lines[0]).toContain("[manufacturing] materialize done");
        expect(lines[0]).toContain('"stlBytes":4');
        expect(lines[1]).toContain("[manufacturing] upload complete");
        expect(lines[1]).toContain('"stlBytes":4');
        expect(lines.join("\n")).not.toMatch(/Jane Doe|settingsJson|firstName/);
    });

    test("a stored STL key logs materialize done without an upload", async () => {
        const lines: string[] = [];
        const original = console.log;
        console.log = (...args: unknown[]) => {
            lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
        };
        let uploaded = 0;
        try {
            const result = await materializeCadOperatorStl({
                plan: plan({ useSavedDesignMesh: false, stlStorageKey: "manufacturing-temp/stored.stl" }),
                credentialId: "cred-1",
                side: "right",
                uploadStl: async () => {
                    uploaded += 1;
                },
            });
            expect(result.stlStorageKey).toBe("manufacturing-temp/stored.stl");
        } finally {
            console.log = original;
        }
        expect(uploaded).toBe(0);
        expect(lines).toEqual(['[manufacturing] materialize done {"stlBytes":null}']);
    });
});
