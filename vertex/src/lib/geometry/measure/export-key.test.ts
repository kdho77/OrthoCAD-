// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { Vector3 } from "three";
import { insoleExportRefreshKey, insoleExportSides } from "@/lib/geometry/measure/export-key";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";

describe("insole export refresh key", () => {
    beforeEach(() => {
        useBottomPatternStore.getState().clear();
        useDesignStore.setState({ design: createDesignWithStockPlaceholder() });
    });

    test("changes when elements, trimline, bottom pattern, or outline change", () => {
        const base = insoleExportRefreshKey();
        const design = useDesignStore.getState().design;
        useDesignStore.setState({
            design: {
                ...design,
                elements: [
                    {
                        id: "e1",
                        kind: "met_pad",
                        side: "left",
                        position: { x: 12, y: 1 },
                        rotationDeg: 0,
                        scale: { x: 1, y: 1 },
                        heightMm: 3,
                    },
                ],
            },
        });
        const withElement = insoleExportRefreshKey();
        expect(withElement).not.toBe(base);

        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                trimlines: { left: [{ x: 1, y: 2, z: 0 }] },
            },
        });
        const withTrim = insoleExportRefreshKey();
        expect(withTrim).not.toBe(withElement);

        useBottomPatternStore.getState().setPattern("left", {
            points: [new Vector3(0, 0, 0), new Vector3(8, 1, 0)],
        });
        const withBottom = insoleExportRefreshKey();
        expect(withBottom).not.toBe(withTrim);

        useBaseOutlineStore.getState().setOutline("sample-top", {
            points: [new Vector3(4, 0, 0), new Vector3(5, 1, 0)],
        });
        expect(insoleExportRefreshKey()).not.toBe(withBottom);
    });

    test("only lists feet that the order would export", () => {
        expect(insoleExportSides()).toEqual(["left", "right"]);
        const design = createDesignWithStockPlaceholder();
        if (design.paired) design.paired.rightBase = undefined;
        useDesignStore.setState({ design });
        expect(insoleExportSides()).toEqual(["left"]);
    });
});
