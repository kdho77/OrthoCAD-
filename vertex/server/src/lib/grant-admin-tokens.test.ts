// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { isGrantRpcUnavailable, parseGrantRpcResult } from "./grant-admin-tokens";

describe("grant admin tokens helpers", () => {
    test("treats a missing PostgREST RPC as unavailable so super admin can fall back", () => {
        expect(isGrantRpcUnavailable("Could not find the function public.vertex_grant_admin_tokens")).toBe(
            true,
        );
        expect(isGrantRpcUnavailable("PGRST202: schema cache")).toBe(true);
        expect(isGrantRpcUnavailable("function vertex_grant_admin_tokens(unknown) does not exist")).toBe(
            true,
        );
        expect(isGrantRpcUnavailable("NOT_FOUND")).toBe(false);
    });

    test("parses a successful RPC jsonb payload", () => {
        expect(parseGrantRpcResult({ ok: true, balance: 120 })).toEqual({ ok: true, balance: 120 });
        expect(parseGrantRpcResult(null)).toBeNull();
        expect(parseGrantRpcResult({ ok: true })).toBeNull();
    });
});
