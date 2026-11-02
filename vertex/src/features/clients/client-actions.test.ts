// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import { shoeChartFromInput } from "../../../shared/client-files";
import { designStateForKind } from "./client-actions";

describe("designStateForKind", () => {
    test("uses the client chart size instead of the stock placeholder default", () => {
        const stock = createDesignWithStockPlaceholder();
        const chart = shoeChartFromInput({ shoeSizeUs: 11.5, shoeWidth: "wide" });
        const state = designStateForKind("afo", chart);
        expect(state.usMenSize).toBe(11.5);
        expect(state.shoeWidth).toBe("wide");
        expect(stock.usMenSize).not.toBe(11.5);
    });
});
