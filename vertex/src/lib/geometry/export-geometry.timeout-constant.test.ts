// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { EXPORT_OPERATION_TIMEOUT_MS } from "@/lib/geometry/export-geometry";

describe("export timeout constant", () => {
    test("EXPORT_OPERATION_TIMEOUT_MS is 120 seconds", () => {
        expect(EXPORT_OPERATION_TIMEOUT_MS).toBe(120_000);
    });
});
