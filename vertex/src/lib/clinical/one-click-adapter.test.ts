// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { usMenFootLengthMm } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import { defaultShoeChart, shoeChartFromInput } from "../../../shared/client-files";
import { designFromScan, templateDesignFromChart } from "./chart-design";
import { classifyArchHeightMm } from "./one-click-adapter";
import { archHeightFromDots } from "./scan-dots";

describe("chart template and scan corrections", () => {
    test("a default chart loads the same template state as a stock design", () => {
        const stock = createDesignWithStockPlaceholder();
        const fromChart = templateDesignFromChart(defaultShoeChart());
        expect(fromChart.usMenSize).toBe(stock.usMenSize);
        expect(fromChart.shoeWidth).toBe(stock.shoeWidth);
        expect(fromChart.corrections).toEqual(stock.corrections);
        expect(fromChart.base).toEqual(stock.base);
        expect(fromChart.paired?.leftBase?.url).toBe(stock.paired?.leftBase?.url);
        expect(fromChart.paired?.rightBase?.glbPath).toBe(stock.paired?.rightBase?.glbPath);
    });

    test("generated size follows the chart and a standard scan does not change the mesh fields", () => {
        const chart = shoeChartFromInput({ shoeSizeUs: 11, shoeWidth: "wide" });
        const design = templateDesignFromChart(chart);
        expect(design.usMenSize).toBe(11);
        expect(design.shoeWidth).toBe("wide");
        expect(design.paired?.leftBase?.url).toBe(createDesignWithStockPlaceholder().paired?.leftBase?.url);
        const stock = createDesignWithStockPlaceholder();
        const scanned = designFromScan(defaultShoeChart(), [
            { side: "left", archHeightMm: 24, flexible: false },
            { side: "right", archHeightMm: 23, flexible: false },
        ]);
        expect(scanned.corrections).toEqual(stock.corrections);
        expect(scanned.base).toEqual(stock.base);
    });

    test("arch bands and flexible write only the existing correction fields", () => {
        expect(classifyArchHeightMm(17.9)).toMatchObject({ band: "low", deltaMm: -3.5, flagged: true });
        expect(classifyArchHeightMm(18)).toMatchObject({ band: "low", deltaMm: -3.5, flagged: false });
        expect(classifyArchHeightMm(22.9)).toMatchObject({ band: "low", deltaMm: -3.5, flagged: false });
        expect(classifyArchHeightMm(23)).toMatchObject({ band: "standard", deltaMm: 0, flagged: false });
        expect(classifyArchHeightMm(26)).toMatchObject({ band: "standard", deltaMm: 0, flagged: false });
        expect(classifyArchHeightMm(26.1)).toMatchObject({ band: "high", deltaMm: 3, flagged: false });

        const design = designFromScan(defaultShoeChart(), [
            { side: "left", archHeightMm: 17, flexible: true },
            { side: "right", archHeightMm: 30, flexible: false },
        ]);
        expect(design.corrections.left.archHeightMm).toBe(-3.5);
        expect(design.corrections.left.apexMoveMm).toBe(4);
        expect(design.corrections.right.archHeightMm).toBe(3);
        expect(design.corrections.right.apexMoveMm).toBe(0);
        expect(design.base).toEqual(createDesignWithStockPlaceholder().base);
    });

    test("arch height is the apex distance scaled by chart foot length", () => {
        const length = usMenFootLengthMm(9);
        const height = archHeightFromDots(
            {
                heel: { x: 0.5, y: 0.9 },
                firstMet: { x: 0.35, y: 0.2 },
                fifthMet: { x: 0.65, y: 0.2 },
                archApex: { x: 0.7, y: 0.55 },
            },
            length,
        );
        expect(height).toBeGreaterThan(0);
        expect(classifyArchHeightMm(height).band).toBe("high");
    });

    test("a split chart uses the left size as the single generated size", () => {
        const chart = shoeChartFromInput({
            shoeSizesSplit: true,
            shoeSizeUs: 9,
            shoeSizeLeftUs: 10,
            shoeSizeRightUs: 8,
            shoeWidth: "medium",
        });
        expect(templateDesignFromChart(chart).usMenSize).toBe(10);
        expect(templateDesignFromChart(chart).shoeWidth).toBe("medium");
    });
});
