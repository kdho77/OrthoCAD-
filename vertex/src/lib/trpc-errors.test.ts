// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { mapClientRpcError, mapTrpcHttpFailure, PAYLOAD_TOO_LARGE_MESSAGE } from "./trpc-errors";

describe("mapTrpcHttpFailure", () => {
    test("maps 413 Request Entity Too Large to a stable message", () => {
        expect(mapTrpcHttpFailure(413, "Request Entity Too Large")).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
        expect(mapTrpcHttpFailure(502, "Request Entity Too Large")).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    });
});

describe("mapClientRpcError", () => {
    test("maps the JSON.parse 413 snippet from the UI", () => {
        const raw = `Unexpected token 'R', "Request En"... is not valid JSON`;
        expect(mapClientRpcError(raw, "Export failed")).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    });

    test("passes through unrelated errors", () => {
        expect(mapClientRpcError("Insufficient export tokens", "Export failed")).toBe(
            "Insufficient export tokens",
        );
    });
});
