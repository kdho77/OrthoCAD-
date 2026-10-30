// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

/** Default super_admin test account — mirrors vertex/src/lib/dev-auth.ts */
export const DEV_SUPER_ADMIN = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "kdho@vertexorthopedic.com",
    role: "super_admin",
} as const;

/** Founder emails that always resolve to super_admin, even if users.role says admin. */
export const FOUNDER_SUPER_ADMIN_EMAILS = [DEV_SUPER_ADMIN.email] as const;

export function isDevSuperAdminEmail(email: string | undefined | null): boolean {
    const normalized = email?.trim().toLowerCase();
    return Boolean(normalized && FOUNDER_SUPER_ADMIN_EMAILS.some((e) => e.toLowerCase() === normalized));
}

/**
 * Resolve the session role. Founder email allowlist always wins over JWT metadata
 * and the users-table role — super admin is never blocked by a stale `admin` row.
 */
export function resolveDevRole(email: string | undefined, claimedRole: string | undefined): string {
    if (isDevSuperAdminEmail(email)) return DEV_SUPER_ADMIN.role;
    return claimedRole ?? "clinician";
}

/** Accept offline dev bearer tokens only outside production or when Supabase is unset. */
export function isDevAuthAllowed(supabaseConfigured: boolean): boolean {
    return process.env.NODE_ENV !== "production" || !supabaseConfigured;
}

export function resolveDevBearerUser(
    authHeader: string | undefined,
): { id: string; email: string; role: string } | null {
    if (!authHeader?.startsWith("Bearer dev:")) return null;
    const userId = authHeader.slice("Bearer dev:".length);
    if (userId !== DEV_SUPER_ADMIN.id) return null;
    return { id: DEV_SUPER_ADMIN.id, email: DEV_SUPER_ADMIN.email, role: DEV_SUPER_ADMIN.role };
}
