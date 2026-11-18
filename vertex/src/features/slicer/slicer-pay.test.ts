// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { canDownloadSlicerGcode, formatSlicerPriceLabel, formatUsdFromCents } from "./slicer-pay";

describe("slicer pay display", () => {
    test("formats the server price for one file or an L/R pair", () => {
        expect(formatUsdFromCents(800)).toBe("$8.00");
        expect(formatSlicerPriceLabel(800, 1)).toBe("$8.00");
        expect(formatSlicerPriceLabel(800, 2)).toBe("$16.00");
    });

    test("download stays locked until the server confirms payment", () => {
        expect(canDownloadSlicerGcode("unpaid")).toBe(false);
        expect(canDownloadSlicerGcode("paying")).toBe(false);
        expect(canDownloadSlicerGcode("failed")).toBe(false);
        expect(canDownloadSlicerGcode("paid")).toBe(true);
    });
});
