import { resolveDevRole } from "../lib/dev-auth.js";
import { findActiveLicense, getUserProfile, requireSupabaseAdmin } from "../lib/supabase-db.js";
import { protectedProcedure, publicProcedure, router } from "../trpc.js";

export const userRouter = router({
    // Public health check for load balancers / Render health checks.
    health: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),

    // Returns the authenticated user's profile, token balance and active license.
    me: protectedProcedure.query(async ({ ctx }) => {
        const supabase = requireSupabaseAdmin();
        const profile = await getUserProfile(supabase, ctx.user.id).catch(() => null);
        const license = await findActiveLicense(supabase, ctx.user.id);
        const email = profile?.email ?? ctx.user.email;

        return {
            id: ctx.user.id,
            email,
            fullName: profile?.fullName ?? null,
            role: resolveDevRole(email, profile?.role ?? ctx.user.role) as
                | "super_admin"
                | "admin"
                | "clinician",
            tokenBalance: profile?.tokenBalance ?? 0,
            license: license
                ? {
                      id: license.id,
                      type: license.type,
                      status: license.status,
                      seats: license.seats,
                      startsAt: license.startsAt,
                      expiresAt: license.expiresAt,
                  }
                : null,
        };
    }),
});
