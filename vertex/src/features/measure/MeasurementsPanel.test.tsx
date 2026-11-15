// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, expect, test } from "@rstest/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MeasurementsPanel } from "@/features/measure/MeasurementsPanel";
import { boxMesh, bufferGeometryFromMesh, publishMeasureSolid } from "@/lib/geometry/measure";

let root: Root | null = null;

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
});

test("measurements panel reads export-frame length and width", async () => {
    const geometry = bufferGeometryFromMesh(boxMesh({ x: 0, y: 0, z: 0 }, { x: 275, y: 92.7, z: 20 }));
    const release = publishMeasureSolid({
        id: "insole-right",
        product: "insole",
        side: "right",
        geometry,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root?.render(createElement(MeasurementsPanel, { product: "insole" }));
    });
    const length = host.querySelector('[data-testid="measure-length-right"]');
    const width = host.querySelector('[data-testid="measure-width-right"]');
    expect(length?.textContent).toBe("275.0");
    expect(width?.textContent).toBe("92.7");
    release();
    geometry.dispose();
});
