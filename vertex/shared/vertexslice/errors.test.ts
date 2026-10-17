// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { mapVertexSliceError } from "./errors";

describe("mapVertexSliceError", () => {
    test("maps timeout, 5xx, busy, and bad mesh", () => {
        expect(mapVertexSliceError(504, "Slice timed out", "r1").code).toBe("timeout");
        expect(mapVertexSliceError(500, "boom", "r2").code).toBe("auth_config");
        expect(mapVertexSliceError(500, "boom", "r2").cause).toContain("Something on our side");
        expect(mapVertexSliceError(503, "Server busy", "r3").code).toBe("server_busy");
        expect(mapVertexSliceError(400, "Mesh is not closed / non-manifold", "r4").code).toBe("bad_mesh");
        expect(mapVertexSliceError(401, "Invalid or missing X-API-Key", "r5").code).toBe("auth_config");
        expect(mapVertexSliceError(413, "Upload too large", "r6").code).toBe("payload_too_large");
    });
});
