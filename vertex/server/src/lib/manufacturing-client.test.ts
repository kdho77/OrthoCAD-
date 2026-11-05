// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import {
    callManufacture,
    type ManufacturePayload,
    manufacturingFailureDetail,
    resolveManufactureEndpoint,
} from "./manufacturing-client.js";

const PAYLOAD: ManufacturePayload = {
    job_id: "job-1",
    design_id: "design-1",
    preset_id: "apex-belt-v2",
    stl_url: "https://example.com/insole.stl",
    output_type: "gcode",
    belt_angle_deg: 45,
    side: "left",
    material: "apex_core",
};

const OK_BODY = JSON.stringify({
    ok: true,
    output_type: "gcode",
    gcode: "G0 X0\n",
});

const previousUrl = process.env.MANUFACTURING_SERVICE_URL;
const previousFetch = globalThis.fetch;

afterEach(() => {
    if (previousUrl === undefined) delete process.env.MANUFACTURING_SERVICE_URL;
    else process.env.MANUFACTURING_SERVICE_URL = previousUrl;
    globalThis.fetch = previousFetch;
});

function stubFetch(handler: (url: string, init: RequestInit | undefined) => Response): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        return handler(String(input), init);
    }) as typeof fetch;
}

describe("manufacturing service route", () => {
    test("a service URL that already ends in /manufacture is not doubled into a 404", async () => {
        const urls: string[] = [];
        stubFetch((url, init) => {
            urls.push(`${init?.method ?? "GET"} ${url}`);
            if (url.endsWith("/manufacture/manufacture")) {
                return new Response(JSON.stringify({ detail: "Not Found" }), {
                    status: 404,
                    statusText: "Not Found",
                });
            }
            const sent = JSON.parse(String(init?.body)) as { material?: string };
            expect(sent.material).toBe("apex_core");
            return new Response(OK_BODY, { status: 200, headers: { "content-type": "application/json" } });
        });
        process.env.MANUFACTURING_SERVICE_URL = "http://manufacturing.test/manufacture";

        const result = await callManufacture(PAYLOAD);
        expect(result.gcode).toBe("G0 X0\n");
        expect(urls).toEqual(["POST http://manufacturing.test/manufacture"]);
    });

    test("a platform 404 body is not collapsed to statusText Not Found", async () => {
        stubFetch(
            () =>
                new Response(
                    JSON.stringify({ status: "error", code: 404, message: "Application not found" }),
                    { status: 404, statusText: "Not Found" },
                ),
        );
        process.env.MANUFACTURING_SERVICE_URL = "http://manufacturing.test";

        const error = await callManufacture(PAYLOAD).then(
            () => null,
            (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).message).toBe("Manufacturing service error (404): Application not found");
    });

    test("root URL posts /manufacture once", () => {
        expect(resolveManufactureEndpoint("http://localhost:8001")).toBe("http://localhost:8001/manufacture");
        expect(resolveManufactureEndpoint("http://localhost:8001/")).toBe(
            "http://localhost:8001/manufacture",
        );
        expect(resolveManufactureEndpoint("https://host.example/manufacture/")).toBe(
            "https://host.example/manufacture",
        );
        expect(manufacturingFailureDetail(404, "Not Found", "Not Found")).toBe(
            "Manufacturing service error (404): Not Found",
        );
        expect(
            manufacturingFailureDetail(
                404,
                "Not Found",
                JSON.stringify({ message: "Application not found" }),
            ),
        ).toBe("Manufacturing service error (404): Application not found");
    });

    test("image listens on PORT and the app serves GET / plus POST /manufacture", () => {
        const dockerfile = readFileSync(resolve(process.cwd(), "python-service/Dockerfile"), "utf8");
        const main = readFileSync(resolve(process.cwd(), "python-service/app/main.py"), "utf8");
        expect(dockerfile).toContain("${" + "PORT:-8001}");
        expect(dockerfile).not.toMatch(/--port",\s*"8001"/);
        expect(main).toMatch(/@app\.get\("\/"\)/);
        expect(main).toMatch(/@app\.post\("\/manufacture"\)/);
    });
});
