// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { buildExportGeometry } from "@/lib/geometry/export-geometry";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";

const SAMPLE_TOP_FIXTURE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

describe("right-foot bottom text", () => {
    beforeEach(() => {
        resetSampleTopGeometryCache();
        const buf = readFileSync(SAMPLE_TOP_FIXTURE);
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("SAMPLE_Top")) {
                return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
            }
            throw new Error(`unexpected fetch ${url}`);
        }) as typeof fetch;
    });

    afterEach(() => {
        resetSampleTopGeometryCache();
    });

    test("DONAHUE and DUNNAGAN engrave on the right foot", async () => {
        const viewer = useDesignStore.getState().viewer;
        for (const name of ["DONAHUE", "DUNNAGAN"] as const) {
            const design = createDesignWithStockPlaceholder();
            design.usMenSize = 9;
            design.textMarking = { ...defaultTextMarking("bottom"), text: name, feet: "both" };
            useDesignStore.setState({
                design,
                viewer: { ...viewer, wallModel: "procedural", wallStyle: "straight" },
                stockBaseLoading: false,
                stockBaseResolutionState: "resolved",
            });
            const geo = await buildExportGeometry("right");
            try {
                const ud = geo.userData as { textFitError?: string; bottomOutlineWorld?: unknown[] };
                expect(ud.textFitError ?? "").toBe("");
                expect(ud.bottomOutlineWorld?.length).toBe(name.length);
            } finally {
                geo.dispose();
            }
        }
    }, 180_000);
});
