import { describe, expect, test } from "@rstest/core";
import { heuristicParse } from "./heuristic";

describe("heuristicParse arch tier alignment", () => {
    test("high arch -> archHeightMm 3", () => {
        const { corrections } = heuristicParse("Bilateral high arch orthotics");
        expect(corrections.left?.archHeightMm).toBe(3);
        expect(corrections.right?.archHeightMm).toBe(3);
    });

    test("low arch / flat foot -> archHeightMm -3.5", () => {
        const low = heuristicParse("Low arch custom insole");
        expect(low.corrections.left?.archHeightMm).toBe(-3.5);
        const flat = heuristicParse("Flat foot posting");
        expect(flat.corrections.left?.archHeightMm).toBe(-3.5);
    });

    test("medium arch -> archHeightMm omitted", () => {
        const { corrections } = heuristicParse("Medium arch full contact shell");
        expect(corrections.left?.archHeightMm).toBeUndefined();
        expect(corrections.right?.archHeightMm).toBeUndefined();
    });

    test("arch sensitivity without explicit mm -> capped at -3.5", () => {
        const { corrections } = heuristicParse("Arch sensitivity, pronation control");
        expect(corrections.left?.archHeightMm).toBe(-3.5);
    });

    test("explicit numeric arch mm overrides tier keywords", () => {
        const { corrections } = heuristicParse("High arch with arch 12 mm");
        expect(corrections.left?.archHeightMm).toBe(12);
    });

    test("left and right shoe sizes are kept apart", () => {
        const parsed = heuristicParse("Left shoe size 12, right shoe size 6.5, medium width");
        expect(parsed.shoeSizes).toEqual({ left: 12, right: 6.5 });
    });

    test("a shoe size with no foot applies to both", () => {
        expect(heuristicParse("shoe size 10 full contact").shoeSizes).toEqual({ left: 10, right: 10 });
    });

    test("a left-only shoe size does not invent the right", () => {
        expect(heuristicParse("Left shoe size 11, deep heel cup").shoeSizes).toEqual({ left: 11 });
    });
});
