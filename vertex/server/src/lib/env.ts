// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Warns when production-critical env vars are missing (does not throw in dev). */
export function validateServerEnv(): void {
    const required = ["DATABASE_URL"] as const;
    const missing = required.filter((k) => !process.env[k]?.trim());
    if (missing.length > 0) {
        console.warn(`[vertex] Missing env: ${missing.join(", ")} — DB routes will fail`);
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn("[vertex] Supabase service credentials unset — auth/storage disabled");
    }
    if (!process.env.MANUFACTURING_SERVICE_URL || !process.env.MANUFACTURING_INTERNAL_API_KEY) {
        console.warn("[vertex] Manufacturing service unset — manufacturing.generateSolid will fail");
    }
    if (process.env.CORS_ORIGIN === "*" && process.env.NODE_ENV === "production") {
        console.warn("[vertex] CORS_ORIGIN is * in production — set to your SPA origin");
    }
}
