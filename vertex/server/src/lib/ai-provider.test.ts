// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { getAiConfig, SYSTEM_PROMPT } from "./ai-provider.js";

describe("getAiConfig", () => {
    const env = { ...process.env };

    afterEach(() => {
        process.env = { ...env };
    });

    test("defaults to xai with grok-2-vision-latest when unset", () => {
        delete process.env.AI_PROVIDER;
        delete process.env.AI_MODEL;
        process.env.AI_API_KEY = "test-key";
        const cfg = getAiConfig();
        expect(cfg).toEqual({
            provider: "xai",
            apiKey: "test-key",
            model: "grok-2-vision-latest",
        });
    });

    test("respects explicit anthropic provider", () => {
        process.env.AI_PROVIDER = "anthropic";
        delete process.env.AI_MODEL;
        process.env.AI_API_KEY = "anthropic-key";
        const cfg = getAiConfig();
        expect(cfg?.provider).toBe("anthropic");
        expect(cfg?.model).toBe("claude-3-5-sonnet-latest");
    });

    test("returns null without API key", () => {
        delete process.env.AI_API_KEY;
        expect(getAiConfig()).toBeNull();
    });
});

describe("SYSTEM_PROMPT arch tier education", () => {
    test("documents +3 / default / -3.5 parametric deltas", () => {
        expect(SYSTEM_PROMPT).toMatch(/archHeightMm to 3 \(\+3\.0 mm\)/);
        expect(SYSTEM_PROMPT).toMatch(/omit archHeightMm or set 0/);
        expect(SYSTEM_PROMPT).toMatch(/archHeightMm to -3\.5 \(-3\.5 mm\)/);
    });

    test("documents scan height cutoffs 21.75 and 25.0 mm", () => {
        expect(SYSTEM_PROMPT).toMatch(/> 25\.0 mm/);
        expect(SYSTEM_PROMPT).toMatch(/21\.75–25\.0 mm/);
        expect(SYSTEM_PROMPT).toMatch(/< 21\.75 mm/);
    });

    test("documents fulcrum-first philosophy and guardrails", () => {
        expect(SYSTEM_PROMPT).toMatch(/Fulcrum-first clinical philosophy/);
        expect(SYSTEM_PROMPT).toMatch(/Do NOT raise archHeightMm above/);
        expect(SYSTEM_PROMPT).toMatch(/rearfoot post\/wedge/);
        expect(SYSTEM_PROMPT).toMatch(/arch sensitivity.*Charcot.*archHeightMm: -3\.5/is);
        expect(SYSTEM_PROMPT).toMatch(/Keep left and right feet independent/);
    });
});
