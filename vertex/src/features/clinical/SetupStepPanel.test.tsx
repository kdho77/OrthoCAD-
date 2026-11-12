// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { designStateFromDocument } from "@/features/clients/design-document";
import { SetupStepPanel } from "@/features/clinical/SetupStepPanel";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { ProductionMethod } from "@/types";
import { settingsEnvelopeForSave, settingsForDesignSave } from "../../../server/src/lib/design-schema";
import { readStoredDesignSettings } from "../../../shared/design-settings";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const METHODS: ProductionMethod[] = ["printing_solid", "printing_shell", "milling_3axis"];

function insoleThicknessBlock(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-testid="setup-insole-thickness"]');
}

function thicknessNumberInput(container: HTMLElement): HTMLInputElement {
    const block = insoleThicknessBlock(container);
    if (!block) throw new Error("setup insole thickness missing");
    const input = block.querySelector('input[type="number"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("thickness number input missing");
    return input;
}

function setInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SetupStepPanel insole thickness", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        useDesignStore.setState({ design: createDesignWithStockPlaceholder() });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    test.each(METHODS)("shows Insole thickness on Setup for %s", async (method) => {
        useDesignStore.getState().setMethod(method);
        await act(async () => root.render(createElement(SetupStepPanel)));
        const block = insoleThicknessBlock(container);
        expect(block).toBeTruthy();
        expect(block?.textContent).toContain("Insole thickness");
    });

    test("changing thickness updates design.thicknessMm and survives save/reopen", async () => {
        useDesignStore.getState().setMethod("printing_solid");
        await act(async () => root.render(createElement(SetupStepPanel)));
        const input = thicknessNumberInput(container);
        await act(async () => setInputValue(input, "4.2"));
        expect(useDesignStore.getState().design.thicknessMm).toBe(4.2);

        const saved = settingsForDesignSave(useDesignStore.getState().design);
        const envelope = settingsEnvelopeForSave(useDesignStore.getState().design);
        const stored = readStoredDesignSettings(envelope);
        expect(stored?.thicknessMm).toBe(4.2);
        if (!stored) throw new Error("stored settings missing");

        const reopened = designStateFromDocument({
            id: "design-1",
            pattern: saved.pattern,
            method: saved.method,
            thicknessMm: stored.thicknessMm,
            linked: saved.corrections.linked,
            unit: saved.corrections.unit,
            corrections: [
                { side: "left", ...saved.corrections.left },
                { side: "right", ...saved.corrections.right },
            ],
            elements: saved.elements,
            settingsJson: envelope,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
        } as Parameters<typeof designStateFromDocument>[0]);
        expect(reopened.thicknessMm).toBe(4.2);
    });
});
