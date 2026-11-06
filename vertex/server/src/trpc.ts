import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { type CadOperatorScope, cadOperatorHasScope } from "./auth/cad-operator.js";
import type { Context } from "./context.js";
import { ensureAppUser } from "./lib/ensure-user.js";
import { checkRateLimit, type RateLimitConfig } from "./lib/rate-limit.js";

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

// Requires an authenticated Supabase user (mirrored into app `users` on first request).
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    await ensureAppUser(ctx.user);
    return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Session auth, or a dogfood CAD-operator credential limited to one scope.
 * A CAD-operator key does not satisfy protectedProcedure.
 */
export function sessionOrCadOperatorProcedure(scope: CadOperatorScope) {
    return t.procedure.use(async ({ ctx, next }) => {
        if (ctx.user) {
            await ensureAppUser(ctx.user);
            return next({ ctx: { ...ctx, user: ctx.user } });
        }
        if (cadOperatorHasScope(ctx.cadOperator, scope)) {
            return next({ ctx });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    });
}

export function rateLimitedSessionOrCadProcedure(
    config: RateLimitConfig,
    routeKey: string,
    scope: CadOperatorScope,
) {
    return sessionOrCadOperatorProcedure(scope).use(({ ctx, next }) => {
        const actor = ctx.user?.id ?? (ctx.cadOperator ? `cad:${ctx.cadOperator.credentialId}` : "anonymous");
        const result = checkRateLimit(`${actor}:${routeKey}`, config);
        if (!result.ok) {
            throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: `Rate limit exceeded — retry in ${Math.ceil(result.retryAfterMs / 1000)}s`,
            });
        }
        return next({ ctx });
    });
}

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

// Requires the super_admin role. Role is checked before ensureAppUser so a
// non-super-admin is rejected with 403 even if the users-table mirror is down.
export const superAdminProcedure = t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    if (ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Super admin access required" });
    }
    await ensureAppUser(ctx.user);
    return next({ ctx: { ...ctx, user: ctx.user } });
});
