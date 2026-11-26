// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, test } from "@rstest/core";

import { MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC } from "../../../server/src/lib/storage";
import { readGcodeFromSignedUrl } from "./export-service";

const FIXTURE_GCODE = gunzipSync(
    readFileSync(resolve(__dirname, "../../../../tests/fixtures/handedness/true_left_toe_first.gcode.gz")),
).toString("utf8");

describe("UI G-code signed download", () => {
    test("reads the short-lived URL and does not remove the stored object", async () => {
        expect(MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC).toBe(3600);
        const removed: string[] = [];
        const url = `https://files.example.test/gcode/design/left.gcode?exp=${MANUFACTURING_SIGNED_DOWNLOAD_TTL_SEC}`;
        const text = await readGcodeFromSignedUrl(
            url,
            async () => new Response(FIXTURE_GCODE, { status: 200 }),
        );
        expect(text).toBe(FIXTURE_GCODE);
        expect(removed).toEqual([]);
    });
});
