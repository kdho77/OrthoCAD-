import type { License, Role, UserProfile } from "@/types";

/** Default super_admin test account for offline mode and local Supabase dev sign-in. */
export const DEV_SUPER_ADMIN = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "kdho@vertexorthopedic.com",
    password: "Vertex123$",
    fullName: "K. Dho",
    role: "super_admin" as Role,
    tokenBalance: 100,
} as const;

/** Founder emails that always resolve to super_admin, even if users.role says admin. */
export const FOUNDER_SUPER_ADMIN_EMAILS = [DEV_SUPER_ADMIN.email] as const;

export function isDevSuperAdminEmail(email: string | undefined | null): boolean {
    const normalized = email?.trim().toLowerCase();
    return Boolean(normalized && FOUNDER_SUPER_ADMIN_EMAILS.some((e) => e.toLowerCase() === normalized));
}

/** True when Vite dev server is running (auto sign-in + prefilled login form). */
export function isLocalDevServer(): boolean {
    return import.meta.env.DEV;
}

export function offlineUserProfile(): UserProfile {
    return {
        id: DEV_SUPER_ADMIN.id,
        email: DEV_SUPER_ADMIN.email,
        fullName: DEV_SUPER_ADMIN.fullName,
        role: DEV_SUPER_ADMIN.role,
        tokenBalance: DEV_SUPER_ADMIN.tokenBalance,
    };
}

export function offlineLicense(): License {
    return {
        id: "local-license",
        type: "yearly",
        status: "active",
        seats: 1,
        startsAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
    };
}

/**
 * Resolve the session role. Founder email allowlist always wins over JWT metadata
 * and the users-table role — super admin is never blocked by a stale `admin` row.
 */
export function resolveDevRole(email: string | undefined, claimedRole: unknown): Role {
    if (isDevSuperAdminEmail(email)) return DEV_SUPER_ADMIN.role;
    return (claimedRole as Role) ?? "clinician";
}

/** Bearer token sent to the API when Supabase is not configured locally. */
export function devAuthHeaderValue(): string {
    return `dev:${DEV_SUPER_ADMIN.id}`;
}
