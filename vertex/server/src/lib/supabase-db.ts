// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { getSupabaseAdmin } from "../context.js";

export type ActiveLicenseRow = {
    id: string;
    type: string;
    status: string;
    seats: number;
    startsAt: string;
    expiresAt: string | null;
};

export function requireSupabaseAdmin(): SupabaseClient {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Supabase admin client not configured",
        });
    }
    return supabase;
}

function licenseIsActive(license: { status: string; expiresAt: string | null }): boolean {
    if (license.status !== "active") return false;
    if (!license.expiresAt) return true;
    return new Date(license.expiresAt) > new Date();
}

export async function assertActiveLicense(supabase: SupabaseClient, userId: string): Promise<void> {
    const { error } = await supabase.rpc("vertex_assert_active_license", { p_user_id: userId });
    if (error) {
        if (error.message.includes("NO_VALID_LICENSE")) {
            throw new TRPCError({ code: "FORBIDDEN", message: "No valid license" });
        }
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `License check failed: ${error.message}`,
        });
    }
}

export async function findActiveLicense(
    supabase: SupabaseClient,
    userId: string,
): Promise<ActiveLicenseRow | null> {
    const { data: owned, error: ownedError } = await supabase
        .from("licenses")
        .select("id, type, status, seats, startsAt, expiresAt")
        .eq("status", "active")
        .eq("ownerId", userId);

    if (ownedError) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `License lookup failed: ${ownedError.message}`,
        });
    }

    for (const license of owned ?? []) {
        if (licenseIsActive(license)) {
            return license;
        }
    }

    const { data: seats, error: seatError } = await supabase
        .from("license_seats")
        .select("license:licenses(id, type, status, seats, startsAt, expiresAt)")
        .eq("userId", userId);

    if (seatError) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `License seat lookup failed: ${seatError.message}`,
        });
    }

    for (const seat of seats ?? []) {
        const rawLicense = seat.license as ActiveLicenseRow | ActiveLicenseRow[] | null;
        const license = Array.isArray(rawLicense) ? rawLicense[0] : rawLicense;
        if (license && licenseIsActive(license)) {
            return license;
        }
    }

    return null;
}

export async function getUserTokenBalance(supabase: SupabaseClient, userId: string): Promise<number> {
    const { data, error } = await supabase.from("users").select("tokenBalance").eq("id", userId).single();
    if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "User profile not found" });
    }
    return data.tokenBalance;
}

export async function getUserProfile(
    supabase: SupabaseClient,
    userId: string,
): Promise<{
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    tokenBalance: number;
    isActive: boolean;
}> {
    const { data, error } = await supabase
        .from("users")
        .select("id, email, fullName, role, tokenBalance, isActive")
        .eq("id", userId)
        .single();

    if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "User profile not found" });
    }

    return data;
}

export async function writeAuditLogBestEffort(
    supabase: SupabaseClient,
    data: {
        userId: string | null;
        action: string;
        targetId?: string | null;
        metadata?: Record<string, unknown> | null;
        ipAddress?: string | null;
    },
): Promise<void> {
    try {
        await supabase.from("audit_logs").insert({
            userId: data.userId,
            action: data.action,
            targetId: data.targetId ?? null,
            metadata: data.metadata ?? null,
            ipAddress: data.ipAddress ?? null,
        });
    } catch {
        // Audit is best-effort; never fail the caller because of logging.
    }
}
