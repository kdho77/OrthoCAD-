// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Default super_admin test account — mirrors vertex/src/lib/dev-auth.ts */
export const DEV_SUPER_ADMIN = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "kdho@vertexorthopedic.com",
    role: "super_admin",
} as const;

export function isDevSuperAdminEmail(email: string | undefined | null): boolean {
    return email?.toLowerCase() === DEV_SUPER_ADMIN.email.toLowerCase();
}

export function resolveDevRole(email: string | undefined, metadataRole: string | undefined): string {
    if (isDevSuperAdminEmail(email)) return DEV_SUPER_ADMIN.role;
    return metadataRole ?? "clinician";
}

/** Accept offline dev bearer tokens only outside production or when Supabase is unset. */
export function isDevAuthAllowed(supabaseConfigured: boolean): boolean {
    return process.env.NODE_ENV !== "production" || !supabaseConfigured;
}

export function resolveDevBearerUser(authHeader: string | undefined): { id: string; email: string; role: string } | null {
    if (!authHeader?.startsWith("Bearer dev:")) return null;
    const userId = authHeader.slice("Bearer dev:".length);
    if (userId !== DEV_SUPER_ADMIN.id) return null;
    return { id: DEV_SUPER_ADMIN.id, email: DEV_SUPER_ADMIN.email, role: DEV_SUPER_ADMIN.role };
}
