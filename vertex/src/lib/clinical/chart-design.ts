// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// New designs read shoe size from the client chart and still load SAMPLE_Top
// through createDesignWithStockPlaceholder. No mesh is rebuilt here.

import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState } from "@/types";
import {
    chartGeneratedSize,
    DEFAULT_CHART_SHOE_SIZE_US,
    DEFAULT_CHART_SHOE_WIDTH,
    type ShoeChart,
} from "../../../shared/client-files";
import { applyScanCorrections, type ScanFootCorrection } from "./one-click-adapter";

export function templateDesignFromChart(chart: ShoeChart): DesignState {
    const state = createDesignWithStockPlaceholder();
    const usMenSize = chartGeneratedSize(chart);
    const shoeWidth = chart.shoeWidth;
    if (
        usMenSize === DEFAULT_CHART_SHOE_SIZE_US &&
        shoeWidth === DEFAULT_CHART_SHOE_WIDTH &&
        state.usMenSize === DEFAULT_CHART_SHOE_SIZE_US &&
        (state.shoeWidth ?? DEFAULT_CHART_SHOE_WIDTH) === DEFAULT_CHART_SHOE_WIDTH
    ) {
        return state;
    }
    return {
        ...state,
        sizeSystem: "us",
        usMenSize,
        shoeWidth,
        shoeWidthBySide: { left: shoeWidth, right: shoeWidth },
    };
}

/** SAMPLE_Top at the chart size, plus the arch band and Flexible shift. The scan is not the mesh. */
export function designFromScan(chart: ShoeChart, feet: ScanFootCorrection[]): DesignState {
    return applyScanCorrections(templateDesignFromChart(chart), feet);
}
