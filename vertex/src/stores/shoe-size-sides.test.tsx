// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SetupShoeSizeSelect } from "@/components/layout/LeftSidebar";
import { heuristicParse } from "@/features/ai-prescription/heuristic";
import { applyReviewedPrescriptionToCurrentDesign } from "@/features/clinical/ai-generate-from-text";
import { templateDesignFromChart } from "@/lib/clinical/chart-design";
import {
    formatDesignShoeSizeChip,
    insoleLayoutForUsMenSize,
    insoleLayoutFromDesign,
    usMenSizeForSide,
    usMenToUk,
} from "@/lib/geometry/shoe-size";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { shoeChartFromInput } from "../../shared/client-files";

function reset() {
    useMeshEditStore.setState({ target: null });
    useDesignStore.setState({
        design: defaultDesign(),
        exportSide: "left",
    });
}

describe("per-foot shoe size", () => {
    afterEach(() => {
        reset();
    });

    test("the header chip reads each foot, and a shared size stays one label", () => {
        const split = templateDesignFromChart(
            shoeChartFromInput({
                shoeSizesSplit: true,
                shoeSizeLeftUs: 12,
                shoeSizeRightUs: 6.5,
                shoeWidth: "medium",
            }),
        );
        expect(formatDesignShoeSizeChip(split)).toBe("L 12 / R 6.5 · Medium");
        const shared = templateDesignFromChart(shoeChartFromInput({ shoeSizeUs: 10.5, shoeWidth: "wide" }));
        expect(formatDesignShoeSizeChip(shared)).toBe("US men's 10.5 · Wide");
        expect(shared.usMenSizeBySide).toBeUndefined();
    });

    test("an unlinked edit changes one foot and linking does not copy the other", () => {
        reset();
        const store = useDesignStore.getState();
        store.setLinked(false);
        store.setUsShoeSize(12);
        store.setUsShoeSize(6.5, "right");
        let design = useDesignStore.getState().design;
        expect(usMenSizeForSide(design, "left")).toBe(12);
        expect(usMenSizeForSide(design, "right")).toBe(6.5);
        expect(design.usMenSize).toBe(12);
        expect(design.sizeSystem).toBe("us");

        store.setUsShoeSize(11, "left");
        design = useDesignStore.getState().design;
        expect(usMenSizeForSide(design, "left")).toBe(11);
        expect(usMenSizeForSide(design, "right")).toBe(6.5);

        store.setLinked(true);
        design = useDesignStore.getState().design;
        expect(usMenSizeForSide(design, "left")).toBe(11);
        expect(usMenSizeForSide(design, "right")).toBe(6.5);
        expect(design.corrections.linked).toBe(true);

        store.setUsShoeSize(9);
        design = useDesignStore.getState().design;
        expect(usMenSizeForSide(design, "left")).toBe(9);
        expect(usMenSizeForSide(design, "right")).toBe(9);
        expect(design.usMenSizeBySide).toBeUndefined();
        expect(design.ukSize).toBe(usMenToUk(9));
        expect(design.footLengthMm).toBeCloseTo(insoleLayoutForUsMenSize(9).footLengthMm, 6);
    });

    test("a shared size write matches the single-size footprint", () => {
        reset();
        const before = defaultDesign();
        useDesignStore.getState().setUsShoeSize(11);
        const design = useDesignStore.getState().design;
        const next = insoleLayoutForUsMenSize(11);
        expect(design.usMenSizeBySide).toBeUndefined();
        expect(design.sizeSystem).toBe("us");
        expect(design.usMenSize).toBe(11);
        expect(design.ukSize).toBe(usMenToUk(11));
        expect(design.footLengthMm).toBeCloseTo(next.footLengthMm, 6);
        expect(design.corrections).toEqual(before.corrections);
        expect(insoleLayoutFromDesign(design)).toEqual(insoleLayoutFromDesign(design, "left"));
        expect(insoleLayoutFromDesign(design, "right")).toEqual(insoleLayoutFromDesign(design));
        expect(insoleLayoutFromDesign(design).lengthMm).toBeCloseTo(next.lengthMm, 6);
    });

    test("switching the size unit tab does not change the saved size", async () => {
        reset();
        useDesignStore.getState().setUsShoeSize(12);
        const before = JSON.stringify(useDesignStore.getState().design);
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root: Root = createRoot(container);
        await act(async () => {
            root.render(createElement(SetupShoeSizeSelect));
        });
        for (const unit of ["uk", "mm", "us"] as const) {
            const button = container.querySelector(
                `[data-testid="shoe-size-unit-${unit}"]`,
            ) as HTMLButtonElement;
            await act(async () => {
                button.click();
            });
            expect(JSON.stringify(useDesignStore.getState().design)).toBe(before);
        }
        const select = container.querySelector('[data-testid="setup-shoe-size-select"]') as HTMLSelectElement;
        expect(select.value).toBe("12");
        expect(select.getAttribute("aria-label")).toBe("US shoe size");
        await act(async () => root.unmount());
        container.remove();
    });

    test("the dropdown shows the selected foot, or both sizes when linked and they differ", async () => {
        const split = templateDesignFromChart(
            shoeChartFromInput({
                shoeSizesSplit: true,
                shoeSizeLeftUs: 12,
                shoeSizeRightUs: 6.5,
                shoeWidth: "medium",
            }),
        );
        useDesignStore.setState({
            design: { ...split, corrections: { ...split.corrections, linked: true } },
        });
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root: Root = createRoot(container);
        await act(async () => {
            root.render(createElement(SetupShoeSizeSelect));
        });
        expect(container.querySelector('[data-testid="setup-shoe-size-both"]')?.textContent).toMatch(
            /L .*12/,
        );
        expect(container.querySelector('[data-testid="setup-shoe-size-both"]')?.textContent).toMatch(/6\.5/);
        const dimensions =
            container.querySelector('[data-testid="setup-shoe-size-dimensions"]')?.textContent ?? "";
        const leftLen = insoleLayoutForUsMenSize(12).lengthMm.toFixed(0);
        const rightLen = insoleLayoutForUsMenSize(6.5).lengthMm.toFixed(0);
        expect(dimensions).toContain(leftLen);
        expect(dimensions).toContain(rightLen);
        expect(leftLen).not.toBe(rightLen);

        useDesignStore.setState({ design: split, exportSide: "right" });
        await act(async () => {
            root.render(createElement(SetupShoeSizeSelect));
        });
        const select = container.querySelector('[data-testid="setup-shoe-size-select"]') as HTMLSelectElement;
        expect(select.getAttribute("aria-label")).toBe("Right shoe size");
        expect(select.value).toBe("6.5");
        await act(async () => root.unmount());
        container.remove();
    });

    test("AI Rx applies a per-foot size and leaves the other foot when editing is unlinked", () => {
        reset();
        useDesignStore.getState().setLinked(false);
        useDesignStore.getState().setUsShoeSize(9);
        applyReviewedPrescriptionToCurrentDesign(heuristicParse("Left shoe size 12, right shoe size 6.5"));
        let design = useDesignStore.getState().design;
        expect(usMenSizeForSide(design, "left")).toBe(12);
        expect(usMenSizeForSide(design, "right")).toBe(6.5);
        expect(design.corrections.linked).toBe(false);

        useDesignStore.setState({ design: defaultDesign() });
        useDesignStore.getState().setLinked(false);
        applyReviewedPrescriptionToCurrentDesign(heuristicParse("Left shoe size 11, met pad"));
        design = useDesignStore.getState().design;
        expect(usMenSizeForSide(design, "left")).toBe(11);
        expect(usMenSizeForSide(design, "right")).toBe(9);

        useDesignStore.setState({ design: defaultDesign() });
        applyReviewedPrescriptionToCurrentDesign(heuristicParse("Left shoe size 10"));
        design = useDesignStore.getState().design;
        expect(design.corrections.linked).toBe(true);
        expect(usMenSizeForSide(design, "left")).toBe(10);
        expect(usMenSizeForSide(design, "right")).toBe(10);
    });

    test("AI generate from a split chart keeps both sizes when the text has no size", () => {
        const chart = shoeChartFromInput({
            shoeSizesSplit: true,
            shoeSizeLeftUs: 12,
            shoeSizeRightUs: 6.5,
            shoeWidth: "medium",
        });
        useDesignStore.setState({ design: templateDesignFromChart(chart) });
        applyReviewedPrescriptionToCurrentDesign(heuristicParse("Bilateral high arch orthotics"));
        const design = useDesignStore.getState().design;
        expect(usMenSizeForSide(design, "left")).toBe(12);
        expect(usMenSizeForSide(design, "right")).toBe(6.5);
        expect(design.corrections.left.archHeightMm).toBe(3);
        expect(design.corrections.right.archHeightMm).toBe(3);
        expect(formatDesignShoeSizeChip(design)).toBe("L 12 / R 6.5 · Medium");
    });
});
