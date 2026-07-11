// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { stlExportUserMessage } from "@/features/exports/export-user-message";

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

    test("undefined → Export failed", () => {
        expect(stlExportUserMessage(undefined)).toBe("Export failed");
    });
});
