// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { TRPCError } from "@trpc/server";
import { getSupabaseAdmin } from "../context.js";

const VALID_ROLES: readonly string[] = ["super_admin", "admin", "clinician"];

/**
 * Mirror a Supabase-authenticated user into the app `users` table so foreign keys
 * (token grants, audit logs, exports, etc.) resolve on first authenticated request.
 */
export async function ensureAppUser(user: { id: string; email: string; role: string }): Promise<void> {
    const email = user.email.trim() || `${user.id}@placeholder.invalid`;
    const role = VALID_ROLES.includes(user.role) ? user.role : "clinician";

    const supabase = getSupabaseAdmin();
    if (!supabase) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Supabase admin client not configured",
        });
    }

    const { data: existing, error: lookupError } = await supabase
        .from("users")
        .select("id, email, role, tokenBalance, isActive")
        .eq("email", email)
        .single();

    if (lookupError && lookupError.code !== "PGRST116") {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `User lookup failed: ${lookupError.message}`,
        });
    }

    if (existing) {
        return;
    }

    const { error: upsertError } = await supabase
        .from("users")
        .upsert(
            {
                id: user.id,
                email,
                role,
                tokenBalance: 0,
                isActive: true,
            },
            { onConflict: "email", ignoreDuplicates: false },
        )
        .select("id, email, role, tokenBalance, isActive")
        .single();

    if (upsertError) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `User upsert failed: ${upsertError.message}`,
        });
    }
}
