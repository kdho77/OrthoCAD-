// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { medialSign, medialWidthSignForSide } from "@/lib/clinical/medial-sign";

describe("medialSign", () => {
    test("matches height-field convention", () => {
        expect(medialSign("left")).toBe(-1);
        expect(medialSign("right")).toBe(1);
    });

    test("width sign for landmark crest search", () => {
        expect(medialWidthSignForSide("left")).toBe(1);
        expect(medialWidthSignForSide("right")).toBe(-1);
    });
});
