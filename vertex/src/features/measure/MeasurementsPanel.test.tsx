// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, expect, test } from "@rstest/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MeasurementsPanel } from "@/features/measure/MeasurementsPanel";
import {
    boxMesh,
    bufferGeometryFromMesh,
    overallPrintSize,
    publishMeasureSolid,
    setInsoleExportLoaderForTests,
    triangleMeshFromGeometry,
} from "@/lib/geometry/measure";

let root: Root | null = null;

afterEach(() => {
    setInsoleExportLoaderForTests(null);
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
});

test("print size comes from the export loader, not the viewer preview", async () => {
    const preview = bufferGeometryFromMesh(boxMesh({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }));
    const release = publishMeasureSolid({
        id: "insole-right",
        product: "insole",
        side: "right",
        geometry: preview,
    });
    const exported = triangleMeshFromGeometry(
        bufferGeometryFromMesh(boxMesh({ x: 0, y: 0, z: 0 }, { x: 275, y: 92.73, z: 20 })),
    );
    setInsoleExportLoaderForTests(async () => [
        {
            side: "right",
            source: "export",
            overall: overallPrintSize(exported, "insole", false),
        },
    ]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root?.render(createElement(MeasurementsPanel, { product: "insole" }));
    });
    const row = host.querySelector('[data-testid="measure-overall-right"]');
    expect(row?.getAttribute("data-measure-source")).toBe("export");
    expect(host.querySelector('[data-testid="measure-length-right"]')?.textContent).toBe("275.0");
    expect(host.querySelector('[data-testid="measure-width-right"]')?.textContent).toBe("92.7");
    expect(host.textContent).not.toContain("10.0 × 10.0");
    release();
    preview.dispose();
});

test("a failed export does not show preview numbers", async () => {
    const preview = bufferGeometryFromMesh(boxMesh({ x: 0, y: 0, z: 0 }, { x: 271.9, y: 91.7, z: 23 }));
    const release = publishMeasureSolid({
        id: "insole-left",
        product: "insole",
        side: "left",
        geometry: preview,
    });
    setInsoleExportLoaderForTests(async () => {
        throw new Error("Print size unavailable");
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root?.render(createElement(MeasurementsPanel, { product: "insole" }));
    });
    expect(host.querySelector('[data-testid="measure-export-error"]')?.textContent).toMatch(
        /Print size unavailable/,
    );
    expect(host.textContent).not.toContain("271.9");
    release();
    preview.dispose();
});
