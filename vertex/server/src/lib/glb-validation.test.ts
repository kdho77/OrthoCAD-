// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { validateGlbBase64 } from "./glb-validation";

describe("validateGlbBase64", () => {
    test("accepts valid glTF binary magic", () => {
        const header = Buffer.alloc(12);
        header.writeUInt32LE(0x46546c67, 0);
        const result = validateGlbBase64(header.toString("base64"));
        expect(result.ok).toBe(true);
    });

    test("rejects invalid magic header", () => {
        const buf = Buffer.from("not-a-glb");
        const result = validateGlbBase64(buf.toString("base64"));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("magic");
    });
});
