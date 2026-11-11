// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { stageVerifiedUpdate } from "./apply-update";

describe("staged print-bridge updates", () => {
    test("keeps a matching https payload and rejects a tampered body", async () => {
        const body = Buffer.from("installer-bytes");
        const sha256 = createHash("sha256").update(body).digest("hex");
        const dir = mkdtempSync(join(tmpdir(), "bridge-update-stage-"));
        const destination = join(dir, "pending-update.bin");
        const staged = await stageVerifiedUpdate({
            url: "https://downloads.example/OrthoCAD-Print-Bridge-Setup.exe",
            sha256,
            destination,
            fetchImpl: async () => new Response(body),
        });
        expect(staged).toEqual({ ok: true, bytes: body.length });
        expect(readFileSync(destination).equals(body)).toBe(true);
        const tampered = await stageVerifiedUpdate({
            url: "https://downloads.example/OrthoCAD-Print-Bridge-Setup.exe",
            sha256,
            destination,
            fetchImpl: async () => new Response(Buffer.from("other-bytes")),
        });
        expect(tampered).toEqual({ ok: false, reason: "tampered" });
        const insecure = await stageVerifiedUpdate({
            url: "http://downloads.example/setup.exe",
            sha256,
            destination,
            fetchImpl: async () => {
                throw new Error("http must not be fetched");
            },
        });
        expect(insecure).toEqual({ ok: false, reason: "unexpected" });
    });
});
