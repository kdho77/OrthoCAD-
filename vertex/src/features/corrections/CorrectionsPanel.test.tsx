// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CorrectionsPanel } from "./CorrectionsPanel";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root.render(<CorrectionsPanel />);
    });
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

function sliderBlock(labelText: string): HTMLElement[] {
    const labels = [...container.querySelectorAll("label")].filter(
        (label) => label.textContent === labelText,
    );
    return labels.map((label) => {
        const block = label.parentElement?.parentElement;
        if (!block) throw new Error(`missing slider for ${labelText}`);
        return block;
    });
}

describe("CorrectionsPanel arch elongation", () => {
    test("Left and Right show Arch elongation at 0–5 mm and Arch ease is gone", async () => {
        const arch = [...container.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "Arch",
        );
        if (!arch) throw new Error("Arch section missing");
        await act(async () => {
            arch.click();
        });

        expect(container.textContent).not.toMatch(/Arch ease/);
        const blocks = sliderBlock("Arch elongation");
        expect(blocks).toHaveLength(2);
        for (const block of blocks) {
            const range = block.querySelector<HTMLInputElement>('input[type="range"]');
            const number = block.querySelector<HTMLInputElement>('input[type="number"]');
            if (!range || !number) throw new Error("Arch elongation slider missing");
            expect(range.min).toBe("0");
            expect(range.max).toBe("5");
            expect(range.step).toBe("0.5");
            expect(range.value).toBe("0");
            expect(number.min).toBe("0");
            expect(number.max).toBe("5");
            expect(number.value).toBe("0");
            expect(block.textContent).toContain("mm");
        }

        const height = sliderBlock("Arch height");
        expect(height).toHaveLength(2);
        const heightRange = height[0]?.querySelector<HTMLInputElement>('input[type="range"]');
        expect(heightRange?.step).toBe("0.5");
        expect(container.textContent).toContain("left");
        expect(container.textContent).toContain("right");
    });
});
