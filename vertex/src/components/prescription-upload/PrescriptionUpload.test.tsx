// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PrescriptionApplyReview } from "@/components/prescription-upload/PrescriptionApplyReview";
import {
    buildPrescriptionToApply,
    initialReviewDraft,
    patchesAsymmetric,
} from "@/components/prescription-upload/prescription-review-logic";
import { useDesignStore } from "@/stores/design-store";
import type { PrescriptionParseResult } from "@/types";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseResult(overrides?: Partial<PrescriptionParseResult>): PrescriptionParseResult {
    return {
        corrections: {},
        elements: [],
        notes: "",
        confidence: 1,
        provider: "heuristic",
        tokenCost: 0,
        ...overrides,
    };
}

function setInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("prescription review logic", () => {
    test("buildPrescriptionToApply omits unchecked rows", () => {
        const base = baseResult({
            corrections: {
                left: { heelLiftMm: 2, archHeightMm: 5 },
                right: { heelLiftMm: 2, archHeightMm: 5 },
            },
        });
        const { left, right, included } = initialReviewDraft(base);
        included.archHeightMm = false;
        const payload = buildPrescriptionToApply(base, left, right, included);
        expect(payload.corrections.left).toEqual({ heelLiftMm: 2 });
        expect(payload.corrections.right).toEqual({ heelLiftMm: 2 });
    });

    test("patchesAsymmetric detects left-only heel lift", () => {
        const left = { heelLiftMm: 6.35 };
        const right = {};
        const keys = ["heelLiftMm"];
        const included = { heelLiftMm: true };
        expect(patchesAsymmetric(left, right, keys, included)).toBe(true);
    });
});

describe("PrescriptionApplyReview", () => {
    let container: HTMLDivElement;
    let root: Root;
    let applied: PrescriptionParseResult | null;

    beforeEach(() => {
        applied = null;
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                corrections: {
                    ...useDesignStore.getState().design.corrections,
                    linked: true,
                },
            },
        });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    test("editing a value passes the edited payload on Apply all", async () => {
        const result = baseResult({
            corrections: { left: { heelLiftMm: 2 }, right: { heelLiftMm: 2 } },
        });
        await act(async () =>
            root.render(
                createElement(PrescriptionApplyReview, {
                    result,
                    onApply: (edited) => {
                        applied = edited;
                    },
                    onCancel: () => {},
                }),
            ),
        );

        const heelInput = container.querySelector(
            'input[type="number"]',
        ) as HTMLInputElement | null;
        expect(heelInput).toBeTruthy();
        if (!heelInput) throw new Error("heel lift input missing");
        setInputValue(heelInput, "4");
        const applyAll = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Apply all"),
        );
        expect(applyAll).toBeTruthy();
        await act(async () => applyAll?.click());
        expect(applied?.corrections.left?.heelLiftMm).toBe(4);
        expect(applied?.corrections.right?.heelLiftMm).toBe(2);
    });

    test("Apply selected respects include checkboxes", async () => {
        const result = baseResult({
            corrections: {
                left: { heelLiftMm: 1, archHeightMm: 3 },
                right: { heelLiftMm: 1, archHeightMm: 3 },
            },
        });
        await act(async () =>
            root.render(
                createElement(PrescriptionApplyReview, {
                    result,
                    onApply: (edited) => {
                        applied = edited;
                    },
                    onCancel: () => {},
                }),
            ),
        );

        const archCheckbox = container.querySelector(
            'input[aria-label="Include Arch height"]',
        ) as HTMLInputElement | null;
        expect(archCheckbox).toBeTruthy();
        await act(async () => {
            archCheckbox?.click();
        });
        const applySelected = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Apply selected"),
        );
        expect(applySelected).toBeTruthy();
        await act(async () => applySelected?.click());
        expect(applied?.corrections.left).not.toHaveProperty("archHeightMm");
    });

    test("left-only heel lift unlinks design on applyPrescription", () => {
        useDesignStore.getState().applyPrescription(
            baseResult({
                corrections: { left: { heelLiftMm: 6.35 } },
            }),
        );
        expect(useDesignStore.getState().design.corrections.linked).toBe(false);
        expect(useDesignStore.getState().design.corrections.left.heelLiftMm).toBe(6.35);
        expect(useDesignStore.getState().design.corrections.right.heelLiftMm).toBe(0);
    });

    test("full-length posting right only medial 4.5 deg lands in store", async () => {
        const base = useDesignStore.getState().design;
        useDesignStore.setState({
            design: {
                ...base,
                corrections: {
                    ...base.corrections,
                    linked: false,
                    left: { ...base.corrections.left, fullLengthWedge: undefined },
                    right: { ...base.corrections.right, fullLengthWedge: undefined },
                },
            },
        });
        const result = baseResult({
            corrections: {
                right: { fullLengthWedge: { side: "lateral", value: 2, unit: "deg" } },
            },
        });
        await act(async () =>
            root.render(
                createElement(PrescriptionApplyReview, {
                    result,
                    onApply: (edited) => {
                        useDesignStore.getState().applyPrescription(edited);
                    },
                    onCancel: () => {},
                }),
            ),
        );
        const wedgeRow = [...container.querySelectorAll("tr")].find((tr) =>
            tr.textContent?.includes("Full-length"),
        );
        expect(wedgeRow).toBeTruthy();
        const rightCell = wedgeRow!.querySelectorAll("td")[3];
        const medHigh = [...rightCell.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Med high"),
        );
        await act(async () => {
            medHigh?.click();
        });
        const wedgeInput = rightCell.querySelector('input[type="number"]') as HTMLInputElement;
        setInputValue(wedgeInput, "4.5");
        const applyAll = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Apply all"),
        );
        await act(async () => applyAll?.click());
        const rightWedge = useDesignStore.getState().design.corrections.right.fullLengthWedge;
        expect(rightWedge).toEqual({ side: "medial", value: 4.5, unit: "deg" });
        expect(useDesignStore.getState().design.corrections.left.fullLengthWedge).toBeUndefined();
    });
});