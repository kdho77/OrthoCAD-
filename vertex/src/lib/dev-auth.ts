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

export function isDevSuperAdminEmail(email: string | undefined | null): boolean {
    return email?.toLowerCase() === DEV_SUPER_ADMIN.email.toLowerCase();
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

/** Resolve role — dev super_admin account always gets super_admin in dev/offline flows. */
export function resolveDevRole(email: string | undefined, metadataRole: unknown): Role {
    if (isDevSuperAdminEmail(email)) return DEV_SUPER_ADMIN.role;
    return (metadataRole as Role) ?? "clinician";
}

/** Bearer token sent to the API when Supabase is not configured locally. */
export function devAuthHeaderValue(): string {
    return `dev:${DEV_SUPER_ADMIN.id}`;
}
