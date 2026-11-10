// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { manifestUrlForPayload, RELEASE_UPDATE_MANIFEST_URL, resolveUpdateManifestUrl } from "./baked-config";

describe("baked print bridge update config", () => {
    test("the committed public key is the production SPKI key", () => {
        const keys = JSON.parse(
            readFileSync("vertex/print-bridge/packaging/update-public-keys.json", "utf8"),
        ) as Record<string, string>;
        const pem = keys["orthocad-print-bridge"];
        expect(pem).toBe(
            "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxTrxRpFCCmghMEqKTQ1cEtWdtwHMxxg3ApZGQQuN0UI=\n-----END PUBLIC KEY-----\n",
        );
        expect(JSON.stringify(keys)).not.toContain("REPLACE-WITH-PRODUCTION-PUBLIC-KEY");
        expect(createPublicKey(pem).asymmetricKeyType).toBe("ed25519");
    });

    test("release builds bake the manifest URL and a local env value overrides it", () => {
        expect(
            manifestUrlForPayload({
                origin: "https://orthocad.vertexorthopedic.com",
            }),
        ).toBe(RELEASE_UPDATE_MANIFEST_URL);
        expect(manifestUrlForPayload({ origin: "https://localhost.example" })).toBe("");
        expect(
            resolveUpdateManifestUrl({
                envValue: "https://updates.example/manifest.json",
                bakedFile: RELEASE_UPDATE_MANIFEST_URL,
            }),
        ).toBe("https://updates.example/manifest.json");
        expect(
            resolveUpdateManifestUrl({
                bakedFile: `${RELEASE_UPDATE_MANIFEST_URL}\n`,
            }),
        ).toBe(RELEASE_UPDATE_MANIFEST_URL);
        expect(resolveUpdateManifestUrl({})).toBe("");
    });
});
