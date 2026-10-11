// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { parseCorsOrigins, resolveAllowOrigin } from "./cors";

describe("parseCorsOrigins", () => {
    test("defaults to wildcard when unset", () => {
        expect(parseCorsOrigins(undefined)).toEqual(["*"]);
        expect(parseCorsOrigins("")).toEqual(["*"]);
    });

    test("splits a comma-separated Catalyst allow-list", () => {
        expect(
            parseCorsOrigins(
                "http://localhost:5180, https://orthocad-web.onslate.com, https://orthocad-942536996.development.catalystserverless.com",
            ),
        ).toEqual([
            "http://localhost:5180",
            "https://orthocad-web.onslate.com",
            "https://orthocad-942536996.development.catalystserverless.com",
        ]);
    });
});

describe("resolveAllowOrigin", () => {
    test("reflects the request origin when configured as *", () => {
        expect(resolveAllowOrigin("https://orthocad-web.onslate.com", "*")).toBe(
            "https://orthocad-web.onslate.com",
        );
        expect(resolveAllowOrigin(undefined, "*")).toBe("*");
    });

    test("allows the matching Slate origin from a list", () => {
        const configured = "http://localhost:5180,https://orthocad-web.onslate.com";
        expect(resolveAllowOrigin("https://orthocad-web.onslate.com", configured)).toBe(
            "https://orthocad-web.onslate.com",
        );
        expect(resolveAllowOrigin("http://localhost:5180", configured)).toBe("http://localhost:5180");
    });

    test("does not reflect an unknown origin", () => {
        const configured = "https://orthocad-web.onslate.com";
        expect(resolveAllowOrigin("https://evil.example", configured)).toBe(
            "https://orthocad-web.onslate.com",
        );
    });
});
