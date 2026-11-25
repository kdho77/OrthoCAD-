// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { getAiConfig } from "./ai-provider.js";

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
