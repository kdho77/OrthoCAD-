// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    IDLE_LOGOUT_MS,
    IDLE_WARNING_MS,
    idleLogoutSignOutOptions,
    inactivityPhase,
} from "../../../shared/client-files";
import {
    consumePendingManualSignOut,
    inactivityPhaseDuringExport,
    isRefreshTokenExpiredError,
    markPendingManualSignOut,
    resolveSessionLossAfterFailedRefresh,
    shouldRetrySessionRefresh,
} from "./auth-session-resilience";

describe("auth session resilience", () => {
    test("retries refresh when a signed-in user loses the session unexpectedly", () => {
        expect(shouldRetrySessionRefresh("TOKEN_REFRESHED", true, false)).toBe(true);
        expect(shouldRetrySessionRefresh("SIGNED_OUT", true, false)).toBe(true);
        expect(shouldRetrySessionRefresh("SIGNED_OUT", true, true)).toBe(false);
        expect(shouldRetrySessionRefresh("INITIAL_SESSION", false, false)).toBe(false);
    });

    test("export in flight keeps the user on re-auth instead of clearing state", () => {
        const decision = resolveSessionLossAfterFailedRefresh({
            manualSignOut: false,
            exportBusy: true,
            event: "TOKEN_REFRESHED",
            refreshError: null,
        });
        expect(decision).toBe("reauth");
    });

    test("explicit sign-out clears the user after refresh fails", () => {
        markPendingManualSignOut();
        expect(consumePendingManualSignOut()).toBe(true);
        const decision = resolveSessionLossAfterFailedRefresh({
            manualSignOut: true,
            exportBusy: false,
            event: "SIGNED_OUT",
            refreshError: { message: "invalid_grant" },
        });
        expect(decision).toBe("clear");
    });

    test("SIGNED_OUT without export clears the user when refresh cannot recover", () => {
        const decision = resolveSessionLossAfterFailedRefresh({
            manualSignOut: false,
            exportBusy: false,
            event: "SIGNED_OUT",
            refreshError: { message: "Auth session missing" },
        });
        expect(decision).toBe("clear");
    });

    test("expired refresh token mid-work routes to re-auth", () => {
        expect(isRefreshTokenExpiredError({ message: "refresh_token not found" })).toBe(true);
        const decision = resolveSessionLossAfterFailedRefresh({
            manualSignOut: false,
            exportBusy: false,
            event: "TOKEN_REFRESHED",
            refreshError: { message: "refresh_token not found" },
        });
        expect(decision).toBe("reauth");
    });

    test("idle logout keeps local sign-out scope", () => {
        expect(idleLogoutSignOutOptions).toEqual({ scope: "local" });
    });

    test("export busy would not reach logout phase at the idle threshold", () => {
        expect(inactivityPhase(IDLE_LOGOUT_MS)).toBe("logout");
        expect(inactivityPhaseDuringExport(IDLE_LOGOUT_MS, true)).toBe("active");
        expect(inactivityPhaseDuringExport(IDLE_WARNING_MS, true)).toBe("active");
        expect(inactivityPhase(IDLE_WARNING_MS)).toBe("warning");
    });
});
