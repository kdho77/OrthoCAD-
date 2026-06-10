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
    if (!process.env.MANUFACTURING_SERVICE_URL && !process.env.PYTHON_MANUFACTURING_URL) {
        console.warn(
            "[vertex] MANUFACTURING_SERVICE_URL not set — manufacturing.generateSolid will fall back to " +
                "http://localhost:8001 and fail in production. Point it at the Python manufacturing service.",
        );
    }
    if (
        (process.env.MANUFACTURING_SERVICE_URL || process.env.PYTHON_MANUFACTURING_URL) &&
        !process.env.MANUFACTURING_INTERNAL_API_KEY
    ) {
        console.warn(
            "[vertex] MANUFACTURING_INTERNAL_API_KEY not set — calls to the manufacturing service will be unauthenticated.",
        );
    }
    if (process.env.CORS_ORIGIN === "*" && process.env.NODE_ENV === "production") {
        console.warn("[vertex] CORS_ORIGIN is * in production — set to your SPA origin");
    }
}
