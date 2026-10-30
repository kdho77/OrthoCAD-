// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    assertShippedPatternUntouched,
    hashClosedLoop,
    rimMatchesShippedSampleTop,
    SHIPPED_CONTROL_HASH,
    SHIPPED_PATTERN_SOURCE_SHA,
    shippedControlHash,
    shippedPatternHash,
    shippedSampleTopControls,
    shippedSampleTopPattern,
    shippedStyleMetrics,
} from "./shipped-pattern";

describe("shipped SAMPLE_Top pattern freeze", () => {
    test("frozen samples load as data and hash the a2f7cc61 baseline", () => {
        assertShippedPatternUntouched();
        const samples = shippedSampleTopPattern();
        expect(samples.length).toBeGreaterThan(80);
        expect(hashClosedLoop(samples)).toBe(shippedPatternHash());
        expect(hashClosedLoop(shippedSampleTopControls())).toBe(SHIPPED_CONTROL_HASH);
        expect(shippedControlHash()).toBe(SHIPPED_CONTROL_HASH);
        expect(rimMatchesShippedSampleTop(samples)).toBe(false);
        const metrics = shippedStyleMetrics();
        expect(metrics.straight.sourceSha).toBe(SHIPPED_PATTERN_SOURCE_SHA);
        expect(metrics.straight.stlMd5).toBe("a982e5847d9cecbf51e6c29c253bf150");
        expect(metrics.round.stlMd5).toBe("0000e90aecd13fff62b7d5d4f67d64ae");
        expect(metrics.hybrid.stlMd5).toBe("3b4bff78a92cd974bdbb51c90467d611");
    });
});
