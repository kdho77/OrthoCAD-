// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "@rstest/core";
import { signUpdateManifest, type UpdatePayload, verifySignedManifest } from "./print-bridge-update";
import { PRINT_BRIDGE_PRODUCT, PRINT_BRIDGE_VERSION } from "./print-bridge-version";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const NOW = new Date("2026-11-10T12:00:00.000Z");

function payload(version: string, expiresAt = "2027-11-10T00:00:00.000Z"): UpdatePayload {
    return {
        product: PRINT_BRIDGE_PRODUCT,
        channel: "stable",
        version,
        minVersion: "2026.11.09.0",
        releasedAt: "2026-11-10T00:00:00.000Z",
        expiresAt,
        platforms: {
            "win32-x64": {
                url: "https://downloads.example/OrthoCAD-Print-Bridge-Setup.exe",
                sha256: "a".repeat(64),
            },
            "darwin-arm64": {
                url: "https://downloads.example/OrthoCAD-Print-Bridge.pkg",
                sha256: "b".repeat(64),
            },
        },
    };
}

function verify(manifest: unknown, installedVersion = PRINT_BRIDGE_VERSION) {
    return verifySignedManifest({
        manifest,
        publicKeys: { "test-key": PUBLIC_PEM },
        installedVersion,
        now: NOW,
        platform: "win32-x64",
    });
}

describe("signed print-bridge update manifests", () => {
    test("a valid signed manifest is accepted and the installed version is compared", () => {
        const signed = signUpdateManifest(payload("2026.11.10.2"), PRIVATE_PEM, "test-key");
        expect(verify(signed)).toMatchObject({
            ok: true,
            version: "2026.11.10.2",
            platform: "win32-x64",
        });
        expect(verify(signed, "2026.11.10.2")).toEqual({ ok: false, reason: "downgrade" });
        expect(
            verify(signUpdateManifest(payload("2026.11.09.1"), PRIVATE_PEM, "test-key"), "2026.11.10.1"),
        ).toEqual({
            ok: false,
            reason: "downgrade",
        });
    });

    test("tampered, unsigned, expired, and untrusted manifests are rejected", () => {
        const signed = signUpdateManifest(payload("2026.11.10.2"), PRIVATE_PEM, "test-key");
        const tampered = {
            ...signed,
            payload: { ...signed.payload, version: "2026.11.10.9" },
        };
        expect(verify(tampered)).toEqual({ ok: false, reason: "tampered" });
        expect(verify({ ...signed, signature: "" })).toEqual({ ok: false, reason: "unsigned" });
        expect(verify({ keyId: "test-key", payload: signed.payload })).toEqual({
            ok: false,
            reason: "unsigned",
        });
        const expired = signUpdateManifest(
            {
                ...payload("2026.11.10.2"),
                releasedAt: "2026-11-01T00:00:00.000Z",
                expiresAt: "2026-11-09T00:00:00.000Z",
            },
            PRIVATE_PEM,
            "test-key",
        );
        expect(verify(expired)).toEqual({ ok: false, reason: "expired" });
        expect(
            verifySignedManifest({
                manifest: signed,
                publicKeys: { "test-key": "REPLACE-WITH-PRODUCTION-PUBLIC-KEY" },
                installedVersion: PRINT_BRIDGE_VERSION,
                now: NOW,
                platform: "win32-x64",
            }),
        ).toEqual({ ok: false, reason: "untrusted-key" });
        expect(verify({ ...signed, keyId: "unknown" })).toEqual({ ok: false, reason: "untrusted-key" });
    });
});
