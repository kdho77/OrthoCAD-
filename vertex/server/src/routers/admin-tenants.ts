// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { z } from "zod";
import {
    archiveTenant,
    createTenant,
    exportAdminAuditCsv,
    extendTenant,
    getTenant,
    grantTenantTokens,
    listAdminAudit,
    listLedger,
    listTenants,
    setTenantStatus,
    undoGrant,
    updateTenantLicense,
} from "../lib/admin-tenant-store.js";
import { requireSupabaseAdmin } from "../lib/supabase-db.js";
import { router, superAdminProcedure } from "../trpc.js";

const planSchema = z.enum(["starter", "professional", "clinic", "enterprise"]);
const licenseStatusSchema = z.enum(["active", "trial", "suspended", "expired"]);
const uuid = z.string().uuid();

export const adminTenantsRouter = router({
    list: superAdminProcedure.query(async () => {
        return listTenants(requireSupabaseAdmin());
    }),

    get: superAdminProcedure.input(z.object({ id: uuid })).query(async ({ input }) => {
        const supabase = requireSupabaseAdmin();
        const tenant = await getTenant(supabase, input.id);
        const ledger = await listLedger(supabase, input.id);
        const audit = await listAdminAudit(supabase, { tenantId: input.id, limit: 100 });
        return { tenant, ledger, audit };
    }),

    create: superAdminProcedure
        .input(
            z.object({
                name: z.string().min(1).max(120),
                plan: planSchema,
                seats: z.number().int().min(1).max(500),
                status: z.enum(["active", "trial"]),
                startsAt: z.string().datetime().optional(),
                expiresAt: z.string().datetime().nullable().optional(),
                initialTokens: z.number().int().optional(),
                reason: z.string().min(1).max(400),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            return createTenant(requireSupabaseAdmin(), {
                ...input,
                actorId: ctx.user.id,
                ip: ctx.ip,
            });
        }),

    updateLicense: superAdminProcedure
        .input(
            z.object({
                tenantId: uuid,
                plan: planSchema,
                seats: z.number().int().min(1).max(500),
                startsAt: z.string().datetime(),
                expiresAt: z.string().datetime().nullable(),
                status: licenseStatusSchema,
                reason: z.string().min(1).max(400),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            return updateTenantLicense(requireSupabaseAdmin(), {
                ...input,
                actorId: ctx.user.id,
                ip: ctx.ip,
            });
        }),

    extend: superAdminProcedure
        .input(
            z.object({
                tenantId: uuid,
                days: z.number().int().min(1).max(3660).optional(),
                expiresAt: z.string().datetime().optional(),
                reason: z.string().min(1).max(400),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            return extendTenant(requireSupabaseAdmin(), {
                ...input,
                actorId: ctx.user.id,
                ip: ctx.ip,
            });
        }),

    grantTokens: superAdminProcedure
        .input(
            z.object({
                tenantId: uuid,
                amount: z.number().int(),
                reason: z.string().min(1).max(400),
                note: z.string().max(400).optional(),
                expiresAt: z.string().datetime().nullable().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            return grantTenantTokens(requireSupabaseAdmin(), {
                ...input,
                actorId: ctx.user.id,
                ip: ctx.ip,
            });
        }),

    suspend: superAdminProcedure
        .input(
            z.object({
                tenantId: uuid,
                reason: z.string().min(1).max(400),
                confirmName: z.string().min(1),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            return setTenantStatus(requireSupabaseAdmin(), {
                tenantId: input.tenantId,
                status: "suspended",
                reason: input.reason,
                confirmName: input.confirmName,
                actorId: ctx.user.id,
                ip: ctx.ip,
            });
        }),

    reactivate: superAdminProcedure
        .input(z.object({ tenantId: uuid, reason: z.string().min(1).max(400) }))
        .mutation(async ({ ctx, input }) => {
            return setTenantStatus(requireSupabaseAdmin(), {
                tenantId: input.tenantId,
                status: "active",
                reason: input.reason,
                actorId: ctx.user.id,
                ip: ctx.ip,
            });
        }),

    archive: superAdminProcedure
        .input(z.object({ tenantId: uuid, reason: z.string().min(1).max(400) }))
        .mutation(async ({ ctx, input }) => {
            return archiveTenant(requireSupabaseAdmin(), {
                ...input,
                actorId: ctx.user.id,
                ip: ctx.ip,
            });
        }),

    undoGrant: superAdminProcedure
        .input(z.object({ tenantId: uuid, amount: z.number().int() }))
        .mutation(async ({ ctx, input }) => {
            return undoGrant(requireSupabaseAdmin(), {
                ...input,
                actorId: ctx.user.id,
                ip: ctx.ip,
            });
        }),
});

export const adminAuditRouter = router({
    list: superAdminProcedure
        .input(
            z
                .object({
                    tenantId: uuid.optional(),
                    action: z.string().optional(),
                    from: z.string().datetime().optional(),
                    to: z.string().datetime().optional(),
                    limit: z.number().int().min(1).max(500).default(200),
                })
                .optional(),
        )
        .query(async ({ input }) => {
            return listAdminAudit(requireSupabaseAdmin(), input ?? {});
        }),

    csv: superAdminProcedure
        .input(
            z
                .object({
                    tenantId: uuid.optional(),
                    action: z.string().optional(),
                    from: z.string().datetime().optional(),
                    to: z.string().datetime().optional(),
                })
                .optional(),
        )
        .query(async ({ input }) => {
            return exportAdminAuditCsv(requireSupabaseAdmin(), input ?? {});
        }),
});
