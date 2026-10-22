// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { HYBRID_SEAM_OVERLAP_MESSAGE } from "@/lib/geometry/text-marking/errors";
import type { TextGuide } from "@/lib/geometry/text-marking/place";
import { useDesignStore } from "@/stores/design-store";
import { TextFitList } from "./TextMarkingPanel";
import { publishTextGuide } from "./text-guide-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const guide: TextGuide = {
    minX: 0,
    maxX: 200,
    midY: 0,
    lateral: [],
    medial: [],
    outline: [],
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
    const design = JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
    design.textMarking = { ...defaultTextMarking("wall"), text: "A", capHeightMm: 6, placementU: 0.55 };
    useDesignStore.setState({ design, history: [], future: [] });
    publishTextGuide("left", guide, null);
    publishTextGuide("right", guide, null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    publishTextGuide("left", guide, null);
    publishTextGuide("right", guide, null);
});

describe("hybrid seam overlap message", () => {
    test("shows the transition message instead of an empty fit list", async () => {
        publishTextGuide("left", guide, `[TEXT] ${HYBRID_SEAM_OVERLAP_MESSAGE}`);
        await act(async () => root.render(createElement(TextFitList)));
        expect(container.textContent).toContain(HYBRID_SEAM_OVERLAP_MESSAGE);
    });
});
