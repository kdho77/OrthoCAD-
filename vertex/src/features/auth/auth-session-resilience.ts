// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AuthChangeEvent } from "@supabase/supabase-js";
import { IDLE_LOGOUT_MS, type IdlePhase, inactivityPhase } from "../../../shared/client-files";

let pendingManualSignOut = false;

/** Call immediately before an intentional client sign-out (idle timeout, account menu). */
export function markPendingManualSignOut(): void {
    pendingManualSignOut = true;
}

export function consumePendingManualSignOut(): boolean {
    const pending = pendingManualSignOut;
    pendingManualSignOut = false;
    return pending;
}

export function logAuthStateChange(event: AuthChangeEvent, hasSession: boolean): void {
    console.warn("[auth] onAuthStateChange", {
        event,
        at: Date.now(),
        hasSession,
    });
}

export function logAuthRefreshAttempt(
    event: AuthChangeEvent,
    outcome: "ok" | "failed",
    detail?: string,
): void {
    console.warn("[auth] refreshSession attempt", {
        event,
        at: Date.now(),
        outcome,
        detail: detail ?? null,
    });
}

export function isRefreshTokenExpiredError(error: { message?: string; name?: string } | null): boolean {
    if (!error) return false;
    const blob = `${error.name ?? ""} ${error.message ?? ""}`.toLowerCase();
    return (
        blob.includes("refresh_token") ||
        blob.includes("invalid_grant") ||
        blob.includes("session missing") ||
        blob.includes("jwt expired") ||
        blob.includes("token expired")
    );
}

/** Attempt refreshSession when the stored user disappears without an explicit sign-out. */
export function shouldRetrySessionRefresh(
    event: AuthChangeEvent,
    hadUser: boolean,
    manualSignOut: boolean,
): boolean {
    if (manualSignOut || !hadUser) return false;
    if (event === "INITIAL_SESSION") return false;
    return true;
}

/** After a failed refresh: wipe user only for explicit sign-out; otherwise surface re-auth. */
export function inactivityPhaseDuringExport(idleMs: number, exportBusy: boolean): IdlePhase {
    if (exportBusy) return "active";
    return inactivityPhase(idleMs);
}

export function resolveSessionLossAfterFailedRefresh(input: {
    manualSignOut: boolean;
    exportBusy: boolean;
    event: AuthChangeEvent;
    refreshError: { message?: string; name?: string } | null;
}): "clear" | "reauth" {
    if (input.manualSignOut) return "clear";
    if (input.exportBusy) return "reauth";
    if (input.event === "SIGNED_OUT") return "clear";
    if (isRefreshTokenExpiredError(input.refreshError)) return "reauth";
    return "reauth";
}
