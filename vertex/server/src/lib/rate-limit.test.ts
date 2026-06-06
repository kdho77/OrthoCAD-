// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { checkRateLimit, RATE_LIMITS } from "./rate-limit";

describe("checkRateLimit", () => {
    test("allows requests under the limit", () => {
        const key = `test-${Date.now()}`;
        const cfg = { limit: 2, windowMs: 60_000 };
        expect(checkRateLimit(key, cfg).ok).toBe(true);
        expect(checkRateLimit(key, cfg).ok).toBe(true);
        const third = checkRateLimit(key, cfg);
        expect(third.ok).toBe(false);
    });

    test("export limit config is defined", () => {
        expect(RATE_LIMITS.export.limit).toBeGreaterThan(0);
        expect(RATE_LIMITS.ai.limit).toBeGreaterThan(0);
    });
});
