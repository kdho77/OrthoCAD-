// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AfoVec3 } from "@/lib/geometry/afo/types";
import { orientedSidesKey, useOrientedPlantarSides } from "./AfoMarkerPlacement";

const MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const M1: AfoVec3 = { x: 140, y: -20, z: 2 };
const M5: AfoVec3 = { x: 132, y: 24, z: 1 };

function Host({
    matrix,
    m1,
    m5,
    seen,
    fires,
}: {
    matrix: number[];
    m1: AfoVec3;
    m5: AfoVec3;
    seen: Array<unknown>;
    fires: { n: number };
}) {
    const sides = useOrientedPlantarSides(matrix, m1, m5);
    const prev = useRef<unknown>(undefined);
    if (prev.current !== sides) {
        fires.n += 1;
        prev.current = sides;
    }
    seen.push(sides);
    return null;
}

describe("AFO marker camera axis identity", () => {
    test("oriented sides stay the same object when the matrix and M1/M5 values do not change", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root: Root = createRoot(host);
        const seen: Array<unknown> = [];
        const fires = { n: 0 };
        const draw = (matrix: number[], m1: AfoVec3, m5: AfoVec3) => {
            act(() => {
                root.render(createElement(Host, { matrix, m1, m5, seen, fires }));
            });
        };
        draw(MATRIX, M1, M5);
        draw(MATRIX.slice(), { ...M1 }, { ...M5 });
        expect(seen[0]).toBe(seen[1]);
        expect(fires.n).toBe(1);
        draw(MATRIX.slice(), { ...M1, x: M1.x + 3 }, { ...M5 });
        expect(seen[2]).not.toBe(seen[1]);
        expect(fires.n).toBe(2);
        expect(orientedSidesKey(MATRIX, M1, M5)).toBe(orientedSidesKey(MATRIX.slice(), { ...M1 }, { ...M5 }));
        await act(async () => {
            root.unmount();
        });
        host.remove();
    });
});
