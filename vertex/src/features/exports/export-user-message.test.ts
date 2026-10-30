// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { stlExportUserMessage } from "@/features/exports/export-user-message";
import { PAYLOAD_TOO_LARGE_MESSAGE } from "@/lib/trpc-errors";

describe("stlExportUserMessage", () => {
    test("maps MESH-CLOSE openEdges reason to friendly heel-cup message", () => {
        const raw =
            "[MESH-CLOSE] closeGlbInsoleToSolid not edge-manifold: openEdges=11792 nonManifold=0 euler=3772";
        expect(stlExportUserMessage(raw)).toBe(
            "Heel cup depth correction can't be exported right now (depth must be 0).",
        );
    });

    test("passes through unrelated reasons", () => {
        expect(stlExportUserMessage("API not configured")).toBe("API not configured");
    });

    test("maps JSON.parse of Request Entity Too Large to a stable message", () => {
        expect(stlExportUserMessage(`Unexpected token 'R', "Request En"... is not valid JSON`)).toBe(
            PAYLOAD_TOO_LARGE_MESSAGE,
        );
    });

    test("undefined → Export failed", () => {
        expect(stlExportUserMessage(undefined)).toBe("Export failed");
    });

    test("maps [TEXT] errors to the clear message", () => {
        expect(stlExportUserMessage("[TEXT] too thin, enable Bold or increase size")).toBe(
            "too thin, enable Bold or increase size",
        );
    });
});
