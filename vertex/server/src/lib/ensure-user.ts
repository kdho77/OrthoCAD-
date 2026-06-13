// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PrismaClient, Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { getSupabaseAdmin } from "../context.js";

const VALID_ROLES: readonly string[] = ["super_admin", "admin", "clinician"];

/**
 * Mirror a Supabase-authenticated user into the app `users` table so foreign keys
 * (token grants, audit logs, exports, etc.) resolve on first authenticated request.
 */
export async function ensureAppUser(
    prisma: PrismaClient,
    user: { id: string; email: string; role: string },
): Promise<void> {
    void prisma;
    const role = (VALID_ROLES.includes(user.role) ? user.role : "clinician") as Role;
    const email = user.email.trim() || `${user.id}@placeholder.invalid`;

    const supabase = getSupabaseAdmin();
    if (!supabase) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Supabase admin client not configured",
        });
    }

    const { error } = await supabase.rpc("vertex_ensure_app_user", {
        p_user_id: user.id,
        p_email: email,
        p_role: role,
    });

    if (error) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Ensure app user failed: ${error.message}`,
        });
    }
}
