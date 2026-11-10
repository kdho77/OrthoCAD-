// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop jobs only. This router does not create or edit Vertex Orders.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isSuperAdmin } from "../../../shared/client-files.js";
import {
    releaseAssignedJobToBridge,
    saveMoonrakerPrinter,
    setMoonrakerPrinterEnabled,
} from "../../../shared/moonraker-farm.js";
import { createEnrollment } from "../../../shared/print-bridge-enrollment.js";
import { closedPrinterDispatch } from "../../../shared/printer-adapter.js";
import {
    assignJob,
    cancelDispatchedPrint,
    cancelJob,
    downloadGcode,
    enqueueJob,
    holdJob,
    listProduction,
    markJobDone,
    ProductionError,
    reconcilePrinter,
    refreshPrinterReadiness,
    registerConfiguredPrinter,
    registerMockPrinter,
    rerunJob,
    retryJob,
} from "../../../shared/production-jobs.js";
import { ensureAppUser } from "../lib/ensure-user.js";
import {
    findActiveTenant,
    openProduction,
    resolveProductionShop,
    rethrowProduction,
} from "../lib/production-access.js";
import { serverBridgeDirectory } from "../print-bridge-state.js";
import { protectedProcedure, publicProcedure, router } from "../trpc.js";

// Same roles as adminProcedure. The role is checked before ensureAppUser so a
// non-admin is rejected without writing a user row.
const bridgeAdminProcedure = publicProcedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    if (ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    await ensureAppUser(ctx.user);
    return next({ ctx: { ...ctx, user: ctx.user } });
});

const idInput = z.object({ id: z.string().uuid() });

const shopSelection = {
    tenantId: z.string().uuid().optional(),
    shopId: z.string().uuid().optional(),
};

async function scope(ctx: { user: { id: string; email: string; role: string } }) {
    return openProduction(ctx.user);
}

/**
 * Super-admins enroll and manage printers for the shop they pass in.
 * Everyone else keeps the tenant already on the actor. `optional` list calls
 * with no shop id stay on the actor's current visibility.
 */
async function scopeShop(
    ctx: { user: { id: string; email: string; role: string } },
    input: { tenantId?: string; shopId?: string } | undefined,
    mode: "require" | "optional",
) {
    const opened = await scope(ctx);
    const asked = Boolean(input?.tenantId || input?.shopId);
    if (mode === "optional" && !asked) return opened;
    const shop = resolveProductionShop(opened.actor, input);
    if (!isSuperAdmin(opened.actor)) return opened;
    if (!shop.tenantId) throw new ProductionError("BAD_REQUEST", "A tenant is required.");
    if (shop.tenantId === opened.actor.tenantId) return opened;
    const tenant = await findActiveTenant(shop.tenantId);
    if (!tenant) throw new ProductionError("BAD_REQUEST", "Shop not found.");
    return {
        repo: opened.repo,
        actor: { ...opened.actor, tenantId: tenant.id, tenantName: tenant.name },
    };
}

async function requireOwnedShopPrinter(
    repo: { listPrinters: () => Promise<{ id: string; tenantId: string | null }[]> },
    actor: { role: string; tenantId: string | null },
    printerId: string,
) {
    if (!isSuperAdmin(actor)) return;
    const existing = (await repo.listPrinters()).find((printer) => printer.id === printerId);
    if (!existing?.tenantId || existing.tenantId !== actor.tenantId) {
        throw new ProductionError("NOT_FOUND", "Printer not found");
    }
}

const enqueueInput = z.object({
    designId: z.string().uuid(),
    designName: z.string().min(1).max(120),
    designKind: z.enum(["insole", "afo"]),
    clientId: z.string().uuid(),
    clientLabel: z.string().min(1).max(120),
    process: z.enum(["print", "mill"]),
    dueAt: z.string().datetime().nullable().optional(),
    orderNumber: z.string().max(40).nullable().optional(),
    orderUrl: z.string().url().nullable().optional(),
    orderOpen: z.boolean().optional(),
    gcode: z.string().min(1).max(5_000_000),
});

export const productionRouter = router({
    list: protectedProcedure.input(z.object(shopSelection).optional()).query(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scopeShop(ctx, input, "optional");
            const result = await listProduction(repo, actor);
            if (!isSuperAdmin(actor) || !(input?.tenantId || input?.shopId)) return result;
            return {
                jobs: result.jobs.filter((job) => job.tenantId === actor.tenantId),
                printers: result.printers.filter((printer) => printer.tenantId === actor.tenantId),
            };
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    /** Records a shop job for an existing design. Does not create a customer order. */
    enqueue: protectedProcedure.input(enqueueInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await enqueueJob(repo, actor, input);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    assign: protectedProcedure
        .input(z.object({ id: z.string().uuid(), printerId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await assignJob(repo, actor, input.id, input.printerId);
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    hold: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await holdJob(repo, actor, input.id);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    cancel: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await cancelJob(repo, actor, input.id);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    retry: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await retryJob(repo, actor, input.id);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    markDone: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await markJobDone(repo, actor, input.id);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    rerun: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await rerunJob(repo, actor, input.id);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    download: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await downloadGcode(repo, actor, input.id);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    /**
     * Stores a printer configuration for the software seam.
     * Uses the closed transport: no socket, no credential value, liveVerified stays false.
     */
    registerConfiguredPrinter: protectedProcedure
        .input(
            z.object({
                name: z.string().min(1).max(80),
                protocolId: z.string().min(1).max(80),
                endpoint: z.string().min(1).max(500),
                credentialRef: z.string().min(1).max(80),
                cancellation: z.enum(["unsupported", "explicit"]),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await registerConfiguredPrinter(repo, actor, input);
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    /** Queues the job for the enrolled bridge. The cloud does not dial the printer. */
    dispatch: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            const job = await repo.getJob(input.id);
            const printer = (await repo.listPrinters()).find((item) => item.id === job?.printerId);
            const bridge = printer?.bridgeId
                ? await serverBridgeDirectory.findBridge(printer.bridgeId)
                : null;
            return await releaseAssignedJobToBridge(repo, actor, input.id, bridge);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    saveMoonrakerPrinter: protectedProcedure
        .input(
            z.object({
                id: z.string().uuid().optional(),
                name: z.string().min(1).max(80),
                address: z.string().min(1).max(500),
                bridgeId: z.string().uuid(),
                cancellation: z.enum(["unsupported", "explicit"]),
                enabled: z.boolean(),
                ...shopSelection,
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scopeShop(ctx, input, "require");
                if (isSuperAdmin(actor) && !actor.tenantId) {
                    throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                }
                if (input.id) await requireOwnedShopPrinter(repo, actor, input.id);
                const printer = await saveMoonrakerPrinter(repo, actor, input);
                if (isSuperAdmin(actor) && printer.tenantId !== actor.tenantId) {
                    throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                }
                return printer;
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    setMoonrakerPrinterEnabled: protectedProcedure
        .input(z.object({ id: z.string().uuid(), enabled: z.boolean(), ...shopSelection }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scopeShop(ctx, input, "require");
                if (isSuperAdmin(actor) && !actor.tenantId) {
                    throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                }
                await requireOwnedShopPrinter(repo, actor, input.id);
                const printer = await setMoonrakerPrinterEnabled(repo, actor, input.id, input.enabled);
                if (isSuperAdmin(actor) && printer.tenantId !== actor.tenantId) {
                    throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                }
                return printer;
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    createBridgeEnrollment: bridgeAdminProcedure
        .input(z.object({ bridgeName: z.string().min(1).max(80), ...shopSelection }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { actor } = await scopeShop(ctx, input, "require");
                const bridgeName = input.bridgeName.trim();
                if (!bridgeName) throw new ProductionError("BAD_REQUEST", "A bridge name is required.");
                const origin = process.env.ORTHOCAD_CLOUD_ORIGIN?.trim() ?? "";
                if (!origin.startsWith("https://")) {
                    throw new ProductionError("BAD_REQUEST", "Cloud origin is not configured.");
                }
                if (!actor.tenantId) throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                const bridgeId = crypto.randomUUID();
                const created = createEnrollment({
                    tenantId: actor.tenantId,
                    shopId: actor.tenantId,
                    bridgeId,
                    printerIds: [],
                    origin,
                    now: new Date(),
                });
                await serverBridgeDirectory.putEnrollment(created.record, { name: bridgeName });
                return {
                    bridgeId,
                    bridgeName,
                    proof: created.proof,
                    expiresAt: created.record.expiresAt,
                };
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    revokeBridge: bridgeAdminProcedure
        .input(z.object({ bridgeId: z.string().uuid(), ...shopSelection }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { actor } = await scopeShop(ctx, input, "require");
                if (!actor.tenantId) throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                const ok = await serverBridgeDirectory.revoke(
                    input.bridgeId,
                    actor.tenantId,
                    new Date().toISOString(),
                );
                if (!ok) throw new ProductionError("NOT_FOUND", "Bridge not found.");
                return { revoked: true };
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    reconcile: protectedProcedure
        .input(z.object({ printerId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await reconcilePrinter(repo, actor, input.printerId, closedPrinterDispatch());
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    refreshReadiness: protectedProcedure
        .input(z.object({ printerId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await refreshPrinterReadiness(repo, actor, input.printerId, closedPrinterDispatch());
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    /** Explicit printer cancel. Refuses when cancellation is unsupported or the transport is closed. */
    cancelDispatched: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await cancelDispatchedPrint(repo, actor, input.id, closedPrinterDispatch());
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    /** Mock Moonraker pairing only. Does not open a live printer connection. */
    registerMockPrinter: protectedProcedure
        .input(
            z.object({
                name: z.string().min(1).max(80),
                moonrakerUrl: z.string().min(1).max(500),
                ...shopSelection,
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scopeShop(ctx, input, "require");
                if (isSuperAdmin(actor) && !actor.tenantId) {
                    throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                }
                const result = await registerMockPrinter(repo, actor, input);
                if (isSuperAdmin(actor) && result.printer.tenantId !== actor.tenantId) {
                    throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                }
                return result;
            } catch (error) {
                rethrowProduction(error);
            }
        }),
});
