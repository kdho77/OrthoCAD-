// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { parseSliderEntry } from "./slider-field";

describe("slider number entry", () => {
    test("a leading minus is not snapped to zero", () => {
        expect(parseSliderEntry("-")).toBeNull();
        expect(parseSliderEntry("-3")).toBe(-3);
        expect(parseSliderEntry("-3.5")).toBe(-3.5);
        expect(parseSliderEntry("")).toBeNull();
        expect(parseSliderEntry("0")).toBe(0);
        expect(parseSliderEntry("4")).toBe(4);
    });
});
