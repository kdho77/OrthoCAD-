// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { readUpstreamErrorText, upstreamErrorText } from "./upstream-error.js";

describe("upstream error text", () => {
    test("surfaces Railway message instead of HTTP status text", () => {
        expect(
            upstreamErrorText({ status: "error", code: 404, message: "Application not found" }, "Not Found"),
        ).toBe("Application not found");
    });

    test("surfaces FastAPI detail", () => {
        expect(upstreamErrorText({ detail: "Not Found" }, "Not Found")).toBe("Not Found");
    });

    test("keeps both message and detail when they differ", () => {
        expect(upstreamErrorText({ message: "Application not found", detail: "no route /manufacture" })).toBe(
            "Application not found: no route /manufacture",
        );
    });

    test("joins FastAPI validation messages", () => {
        expect(
            upstreamErrorText({
                detail: [{ loc: ["body", "material"], msg: "Field required", type: "missing" }],
            }),
        ).toBe("body.material: Field required");
    });

    test("readUpstreamErrorText parses a JSON body once", async () => {
        const response = new Response(JSON.stringify({ message: "Application not found" }), {
            status: 404,
            statusText: "Not Found",
        });
        expect(await readUpstreamErrorText(response)).toBe("Application not found");
    });
});
