// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { callManufacture } from "./manufacturing-client.js";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.MANUFACTURING_SERVICE_URL;
    delete process.env.PYTHON_MANUFACTURING_URL;
    delete process.env.MANUFACTURING_INTERNAL_API_KEY;
});

describe("manufacturing client errors", () => {
    test("reports JSON message when the body has no FastAPI detail", async () => {
        process.env.MANUFACTURING_SERVICE_URL = "https://manufacturing.example";
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ status: "error", code: 404, message: "Application not found" }), {
                status: 404,
                statusText: "Not Found",
            })) as typeof fetch;

        await expect(
            callManufacture({
                job_id: "job",
                design_id: "adhoc",
                preset_id: "apex-v2-insole-95a",
                stl_url: "https://storage.example/model.stl",
                output_type: "stl",
                belt_angle_deg: 45,
                side: "left",
            }),
        ).rejects.toThrow("Manufacturing service error (404): Application not found");
    });
});
