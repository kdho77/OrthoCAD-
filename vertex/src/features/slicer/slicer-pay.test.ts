// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    canDownloadSlicerGcode,
    chargeSlicerExport,
    formatSlicerPriceUsd,
    isSlicerPayMock,
    slicerPriceUsd,
} from "./slicer-pay";

describe("slicer pay", () => {
    test("prices one file or an L/R pair", () => {
        expect(slicerPriceUsd(1)).toBe(8);
        expect(slicerPriceUsd(2)).toBe(16);
        expect(formatSlicerPriceUsd(1)).toBe("$8.00");
    });

    test("mock checkout is on until Stripe is wired", () => {
        expect(isSlicerPayMock()).toBe(true);
    });

    test("chargeSlicerExport resolves a mock payment id", async () => {
        const result = await chargeSlicerExport({ fileCount: 1 });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.mock).toBe(true);
            expect(result.paymentId.startsWith("mock_")).toBe(true);
        }
        expect(canDownloadSlicerGcode("unpaid")).toBe(false);
        expect(canDownloadSlicerGcode("paid")).toBe(true);
    });
});
