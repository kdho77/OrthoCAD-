// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import {
    applyRemoteBuildId,
    buildIdsDiffer,
    bundledBuildId,
    fetchDeployedBuildId,
    parseVersionJson,
    resetAppVersionRuntimeForTests,
    setBundledBuildIdForTests,
} from "@/lib/app-version";

const originalFetch = globalThis.fetch;

beforeEach(() => {
    resetAppVersionRuntimeForTests();
    setBundledBuildIdForTests("bundle-abc");
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetAppVersionRuntimeForTests();
});

describe("app-version comparison", () => {
    test("parseVersionJson accepts a string id", () => {
        expect(parseVersionJson({ id: "sha123" })).toEqual({ id: "sha123" });
        expect(parseVersionJson({ id: "  " })).toBeNull();
        expect(parseVersionJson(null)).toBeNull();
    });

    test("buildIdsDiffer fails open when remote is missing", () => {
        expect(buildIdsDiffer("a", null)).toBe(false);
        expect(buildIdsDiffer("a", "")).toBe(false);
        expect(buildIdsDiffer("a", "b")).toBe(true);
        expect(buildIdsDiffer("a", "a")).toBe(false);
    });

    test("applyRemoteBuildId marks stale when ids differ", () => {
        expect(applyRemoteBuildId("bundle-abc")).toBe("current");
        expect(applyRemoteBuildId("bundle-xyz")).toBe("stale");
        expect(applyRemoteBuildId(null)).toBe("unknown");
    });

    test("bundledBuildId reflects test override", () => {
        expect(bundledBuildId()).toBe("bundle-abc");
        setBundledBuildIdForTests("other");
        expect(bundledBuildId()).toBe("other");
    });
});

describe("fetchDeployedBuildId fail-open", () => {
    test("returns null on network error", async () => {
        globalThis.fetch = rs.fn(async () => {
            throw new Error("offline");
        }) as typeof fetch;
        expect(await fetchDeployedBuildId()).toBeNull();
        expect(applyRemoteBuildId(null)).toBe("unknown");
    });

    test("returns null on non-OK response", async () => {
        globalThis.fetch = rs.fn(async () => new Response("", { status: 404 })) as typeof fetch;
        expect(await fetchDeployedBuildId()).toBeNull();
    });

    test("returns null on invalid JSON body", async () => {
        globalThis.fetch = rs.fn(
            async () => new Response(JSON.stringify({}), { status: 200 }),
        ) as typeof fetch;
        expect(await fetchDeployedBuildId()).toBeNull();
    });

    test("returns id when version.json is valid", async () => {
        globalThis.fetch = rs.fn(
            async () => new Response(JSON.stringify({ id: "remote-1" }), { status: 200 }),
        ) as typeof fetch;
        expect(await fetchDeployedBuildId()).toBe("remote-1");
    });
});
