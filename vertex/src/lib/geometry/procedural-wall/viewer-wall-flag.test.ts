// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { useDesignStore } from "@/stores/design-store";
import { applyViewerWallFlagFromSearch, parseViewerWallFlag } from "./viewer-wall-flag";

const LEGACY_VIEWER = {
    transparent: false,
    heightmap: false,
    showLeft: true,
    showRight: true,
    showScans: true,
    view: "iso" as const,
    wallModel: "legacy" as const,
};

beforeEach(() => {
    useDesignStore.setState({ viewer: { ...LEGACY_VIEWER } });
});

describe("viewer wall flag", () => {
    test("parseViewerWallFlag reads wallModel and wallStyle", () => {
        expect(parseViewerWallFlag("?wallModel=procedural&wallStyle=hybrid")).toEqual({
            wallModel: "procedural",
            wallStyle: "hybrid",
        });
        expect(parseViewerWallFlag("wallModel=legacy")).toEqual({ wallModel: "legacy" });
        expect(parseViewerWallFlag("?wallModel=nope&wallStyle=square")).toEqual({});
        expect(parseViewerWallFlag("")).toEqual({});
    });

    test("applyViewerWallFlagFromSearch sets the existing viewer flag", () => {
        expect(applyViewerWallFlagFromSearch("?wallModel=procedural&wallStyle=round")).toBe(true);
        expect(useDesignStore.getState().viewer.wallModel).toBe("procedural");
        expect(useDesignStore.getState().viewer.wallStyle).toBe("round");
    });

    test("applyViewerWallFlagFromSearch is a no-op when the store already matches", () => {
        useDesignStore.setState({
            viewer: { ...LEGACY_VIEWER, wallModel: "procedural", wallStyle: "round" },
        });
        expect(applyViewerWallFlagFromSearch("?wallModel=procedural&wallStyle=round")).toBe(false);
        expect(useDesignStore.getState().viewer.wallModel).toBe("procedural");
    });

    test("ignored query keys leave the default legacy flag", () => {
        expect(applyViewerWallFlagFromSearch("?foo=bar")).toBe(false);
        expect(useDesignStore.getState().viewer.wallModel).toBe("legacy");
    });
});
