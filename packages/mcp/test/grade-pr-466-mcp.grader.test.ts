// Independent MCP grader for PR #466. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";

import { REARFOOT_POSTING_DEG_SIGN, WEDGE_FOOT_FIELD } from "../../../vertex/shared/saved-design-catalog.ts";
import { MCP_TOOL_DEFINITIONS, savedDesignCatalogSchema as mcpCatalogSchema } from "../src/tools/schemas.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("PR #466 MCP grader", () => {
    test("create_saved_design and persist_saved_design_snapshot document foot and posting sign", () => {
        for (const name of ["persist_saved_design_snapshot", "create_saved_design"] as const) {
            const tool = MCP_TOOL_DEFINITIONS.find((entry) => entry.name === name);
            expect(tool?.description, name).toContain("rearfoot_wedge.foot");
            expect(tool?.description, name).toContain("full_length_wedge.foot");
            expect(tool?.description, name).toContain("Positive is valgus (lateral high, pronation)");
            expect(tool?.description, name).toContain("Negative is varus (medial high, supination)");
        }
    });

    test("MCP catalog schema lockstep with vertex shared catalog", () => {
        expect(mcpCatalogSchema.shape.sliders.unwrap().shape.rearfoot_posting_deg.description).toBe(
            REARFOOT_POSTING_DEG_SIGN,
        );
        expect(mcpCatalogSchema.shape.rearfoot_wedge.unwrap().shape.foot.unwrap().description).toBe(
            WEDGE_FOOT_FIELD,
        );
        expect(mcpCatalogSchema.shape.full_length_wedge.unwrap().shape.foot.unwrap().description).toBe(
            WEDGE_FOOT_FIELD,
        );
    });

    test("schemas.ts documents sign in source (not only bundled artifact)", () => {
        const schemas = readFileSync(join(REPO_ROOT, "packages/mcp/src/tools/schemas.ts"), "utf8");
        expect(schemas).toContain("REARFOOT_POSTING_DEG_SIGN");
        expect(schemas).toContain("WEDGE_FOOT_FIELD");
        expect(schemas).toContain("rearfoot_wedge.foot");
        expect(schemas).toContain("full_length_wedge.foot");
    });
});
