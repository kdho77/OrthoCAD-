// Independent grader for PR #456 gate G7. Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import { getAiConfig } from "./ai-provider.js";

const SERVER_ROOT = join(import.meta.dirname, "..", "..");

describe("PR #456 grader G7 — ai-provider defaults and unconfigured message", () => {
    const env = { ...process.env };

    afterEach(() => {
        process.env = { ...env };
    });

    test("G7: defaults to xai with grok-2-vision-latest", () => {
        delete process.env.AI_PROVIDER;
        delete process.env.AI_MODEL;
        process.env.AI_API_KEY = "grader-key";
        expect(getAiConfig()).toEqual({
            provider: "xai",
            apiKey: "grader-key",
            model: "grok-2-vision-latest",
        });
    });

    test("G7: explicit anthropic provider and model", () => {
        process.env.AI_PROVIDER = "anthropic";
        delete process.env.AI_MODEL;
        process.env.AI_API_KEY = "anthropic-key";
        const cfg = getAiConfig();
        expect(cfg?.provider).toBe("anthropic");
        expect(cfg?.model).toBe("claude-3-5-sonnet-latest");
    });

    test("G7: null without API key", () => {
        delete process.env.AI_API_KEY;
        expect(getAiConfig()).toBeNull();
    });

    test("G7: unconfigured router error text unchanged", () => {
        const aiRouter = readFileSync(join(SERVER_ROOT, "src/routers/ai.ts"), "utf8");
        expect(aiRouter).toContain('message: "AI provider not configured (set AI_API_KEY)"');
    });
});
