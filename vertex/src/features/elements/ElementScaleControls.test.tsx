// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { elementGeometryKey } from "@/lib/geometry/element-geometry-key";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import { designStateSchema } from "../../../server/src/lib/design-schema";
import { ElementScaleControls } from "./ElementScaleControls";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sliders = rs.hoisted(
    () =>
        new Map<
            string,
            {
                value: number;
                onPreview: (n: number) => void;
                onChange: (n: number) => void;
            }
        >(),
);
rs.mock("@/components/ui/slider-field", () => ({
    SliderField: (props: {
        label: string;
        value: number;
        onPreview: (n: number) => void;
        onChange: (n: number) => void;
    }) => {
        sliders.set(props.label, props);
        return null;
    },
}));

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
function Harness() {
    const element = useDesignStore((s) => s.design.elements[0]!);
    return <ElementScaleControls element={element} />;
}
beforeEach(async () => {
    frames = new Map();
    frameId = 0;
    rs.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        frames.set(++frameId, cb);
        return frameId;
    });
    rs.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
        frames.delete(id);
    });
    const design = structuredClone(useDesignStore.getInitialState().design);
    design.elements = [
        {
            id: "pad",
            kind: "cluffy_wedge",
            side: "left",
            position: { x: 60, y: -30 },
            rotationDeg: 15,
            scale: { x: 1, y: 1 },
            heightMm: 3,
        },
    ];
    useDesignStore.setState({ design, pendingSessionDesign: null });
    usePerformanceStore.getState().clearAllPreviews();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    rs.restoreAllMocks();
});
async function flushFrames() {
    const callbacks = [...frames.values()];
    frames.clear();
    await act(async () => {
        for (const cb of callbacks) cb(0);
    });
}

describe("element scale controls", () => {
    test("checked by default; preview and commit resize both axes without changing height or pose", async () => {
        expect(container.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
        const before = useDesignStore.getState().design.elements[0]!;
        await act(async () => sliders.get("Scale X")!.onPreview(1.5));
        await flushFrames();
        expect(usePerformanceStore.getState().elementPreviews.pad?.scale).toEqual({ x: 1.5, y: 1.5 });
        expect(sliders.get("Scale Y")!.value).toBe(1.5);
        expect(useDesignStore.getState().design.elements[0]).toBe(before);
        await act(async () => sliders.get("Scale X")!.onChange(1.5));
        expect(useDesignStore.getState().design.elements[0]).toEqual({
            ...before,
            scale: { x: 1.5, y: 1.5 },
        });
        expect(usePerformanceStore.getState().elementPreviews.pad).toBeUndefined();
    });
    test("unlock persists, avoids a geometry change, and allows independent sizing; relock preserves ratio", async () => {
        const geometry = elementGeometryKey(useDesignStore.getState().design.elements);
        await act(async () => container.querySelector<HTMLInputElement>("input")!.click());
        expect(useDesignStore.getState().design.elements[0]!.scaleLocked).toBe(false);
        expect(elementGeometryKey(useDesignStore.getState().design.elements)).toBe(geometry);
        await act(async () => sliders.get("Scale Y")!.onChange(2));
        expect(useDesignStore.getState().design.elements[0]!.scale).toEqual({ x: 1, y: 2 });
        const saved = structuredClone(useDesignStore.getState().design);
        expect(designStateSchema.parse(saved).elements[0]?.scaleLocked).toBe(false);
        await act(async () => useDesignStore.getState().loadDesign(saved));
        expect(container.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
        await act(async () => container.querySelector<HTMLInputElement>("input")!.click());
        await act(async () => sliders.get("Scale X")!.onChange(0.5));
        expect(useDesignStore.getState().design.elements[0]!.scale).toEqual({ x: 0.5, y: 1 });
    });
    test("release before the next frame cancels pending preview, so committed size cannot jump back", async () => {
        await act(async () => sliders.get("Scale X")!.onPreview(1.2));
        await act(async () => sliders.get("Scale X")!.onChange(1.5));
        await flushFrames();
        expect(useDesignStore.getState().design.elements[0]!.scale).toEqual({ x: 1.5, y: 1.5 });
        expect(usePerformanceStore.getState().elementPreviews.pad).toBeUndefined();
    });
});
