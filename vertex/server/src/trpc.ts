import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";
import { checkRateLimit, type RateLimitConfig } from "./lib/rate-limit";

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

// Requires an authenticated Supabase user.
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Applies a per-user sliding-window rate limit to a mutation. */
export function rateLimitedProcedure(config: RateLimitConfig, routeKey: string) {
    return protectedProcedure.use(({ ctx, next }) => {
        const key = `${ctx.user.id}:${routeKey}`;
        const result = checkRateLimit(key, config);
        if (!result.ok) {
            throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: `Rate limit exceeded — retry in ${Math.ceil(result.retryAfterMs / 1000)}s`,
            });
        }
        return next({ ctx });
    });
}

// Requires an admin or super_admin role.
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    return next({ ctx });
});

// Requires the super_admin role.
export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Super admin access required" });
    }
    return next({ ctx });
});
