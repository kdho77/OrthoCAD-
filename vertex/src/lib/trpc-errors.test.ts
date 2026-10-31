// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    looksLikeJsonRpcBody,
    mapClientRpcError,
    mapTrpcHttpFailure,
    PAYLOAD_TOO_LARGE_MESSAGE,
    surfaceTrpcError,
} from "./trpc-errors";

describe("mapTrpcHttpFailure", () => {
    test("maps 413 Request Entity Too Large to a stable message", () => {
        expect(mapTrpcHttpFailure(413, "Request Entity Too Large")).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
        expect(mapTrpcHttpFailure(502, "Request Entity Too Large")).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    });

    test("surfaces Vercel plaintext 500 instead of a JSON.parse error", () => {
        expect(mapTrpcHttpFailure(500, "A server error has occurred")).toMatch(/Server error \(500\)/);
        expect(mapTrpcHttpFailure(500, "A server error has occurred")).toContain(
            "A server error has occurred",
        );
    });
});

describe("mapClientRpcError", () => {
    test("maps the JSON.parse 413 snippet from the UI", () => {
        const raw = `Unexpected token 'R', "Request En"... is not valid JSON`;
        expect(mapClientRpcError(raw, "Export failed")).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    });

    test("does not treat a Vercel 500 parse error as a payload-too-large", () => {
        const raw = `Unexpected token 'A', "A server e"... is not valid JSON`;
        const mapped = mapClientRpcError(raw, "Grant failed");
        expect(mapped).not.toBe(PAYLOAD_TOO_LARGE_MESSAGE);
        expect(mapped).toMatch(/Server error/);
        expect(surfaceTrpcError(new Error(raw))).toMatch(/Server error/);
    });

    test("passes through unrelated errors", () => {
        expect(mapClientRpcError("Insufficient export tokens", "Export failed")).toBe(
            "Insufficient export tokens",
        );
    });

    test("looksLikeJsonRpcBody rejects Vercel plaintext", () => {
        expect(looksLikeJsonRpcBody("A server error has occurred", "text/plain")).toBe(false);
        expect(looksLikeJsonRpcBody('{"error":{"message":"nope"}}', "application/json")).toBe(true);
    });
});
