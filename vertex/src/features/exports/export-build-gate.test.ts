// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import {
    applyRemoteBuildId,
    resetAppVersionRuntimeForTests,
    setBundledBuildIdForTests,
} from "@/lib/app-version";
import { useAppVersionStore } from "@/lib/app-version-store";
import { useDesignStore } from "@/stores/design-store";
import { blockExportIfStaleBuild, staleBuildExportOutcome } from "./export-build-gate";
import { exportDesign } from "./export-service";

rs.mock("@/lib/geometry/export-geometry", () => ({
    buildExportStl: rs.fn(async () => new ArrayBuffer(84)),
    buildOrderPairStl: rs.fn(async () => new ArrayBuffer(84)),
    buildExportGlb: rs.fn(async () => new ArrayBuffer(12)),
    buildOrderPairGeometry: rs.fn(async () => ({ dispose: () => {} })),
    exportModeFromMethod: () => "shell",
    orderDownloadSides: () => ["left"],
}));

rs.mock("@/stores/auth-store", () => ({
    useAuthStore: {
        getState: () => ({
            user: { id: "u1", role: "clinician", tokenBalance: 99 },
            license: { status: "active" },
            deductTokens: () => {},
        }),
    },
}));

rs.mock("@/features/licensing/license", () => ({
    canExport: () => ({ ok: true }),
    TOKEN_COST: { stl: 1, glb: 1, "3mf": 1, gcode: 1 },
}));

beforeEach(() => {
    resetAppVersionRuntimeForTests();
    setBundledBuildIdForTests("build-a");
    useAppVersionStore.getState().resetForTests();
    useDesignStore.setState({
        design: { ...useDesignStore.getState().design, method: "printing_solid", productType: "insole" },
    });
});

afterEach(() => {
    resetAppVersionRuntimeForTests();
    useAppVersionStore.getState().resetForTests();
});

describe("export-build-gate", () => {
    test("does not block when version check is unknown (fail open)", () => {
        applyRemoteBuildId(null);
        expect(blockExportIfStaleBuild()).toBe(false);
        expect(useAppVersionStore.getState().exportBlockedModalOpen).toBe(false);
    });

    test("opens modal and blocks when build is stale", () => {
        applyRemoteBuildId("build-b");
        expect(blockExportIfStaleBuild()).toBe(true);
        expect(useAppVersionStore.getState().exportBlockedModalOpen).toBe(true);
        expect(staleBuildExportOutcome()).toEqual({
            ok: false,
            reason: expect.stringMatching(/Reload to export/i),
        });
    });

    test("exportDesign returns stale message instead of downloading when stale", async () => {
        applyRemoteBuildId("build-b");
        const outcome = await exportDesign("stl", "left");
        expect(outcome.ok).toBe(false);
        expect(outcome.reason).toMatch(/Reload to export/i);
        expect(useAppVersionStore.getState().exportBlockedModalOpen).toBe(true);
    });

    test("does not block export when deployed id matches bundle", () => {
        applyRemoteBuildId("build-a");
        expect(blockExportIfStaleBuild()).toBe(false);
        expect(useAppVersionStore.getState().exportBlockedModalOpen).toBe(false);
    });
});
