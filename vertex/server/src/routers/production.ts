// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop jobs only. This router does not create or edit Vertex Orders.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
    releaseAssignedJobToBridge,
    saveMoonrakerPrinter,
    setMoonrakerPrinterEnabled,
} from "../../../shared/moonraker-farm.js";
import { readOnlyInfoRequest } from "../../../shared/print-bridge-discovery.js";
import { createEnrollment } from "../../../shared/print-bridge-enrollment.js";
import { closedPrinterDispatch } from "../../../shared/printer-adapter.js";
import { productionAddressPolicy } from "../../../shared/printer-address-policy.js";
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
import { openProduction, rethrowProduction } from "../lib/production-access.js";
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

async function scope(ctx: { user: { id: string; email: string; role: string } }) {
    return openProduction(ctx.user);
}

export const productionRouter = router({
    list: protectedProcedure.query(async ({ ctx }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await listProduction(repo, actor);
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
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await saveMoonrakerPrinter(repo, actor, input);
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    setMoonrakerPrinterEnabled: protectedProcedure
        .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await setMoonrakerPrinterEnabled(repo, actor, input.id, input.enabled);
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    createBridgeEnrollment: bridgeAdminProcedure
        .input(z.object({ bridgeName: z.string().min(1).max(80) }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { actor } = await scope(ctx);
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
        .input(z.object({ bridgeId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { actor } = await scope(ctx);
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

    approveBridgePairing: bridgeAdminProcedure
        .input(z.object({ code: z.string().min(4).max(32), bridgeName: z.string().min(1).max(80) }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { actor } = await scope(ctx);
                if (!actor.tenantId) throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                const result = await serverBridgeDirectory.approvePairing({
                    code: input.code,
                    tenantId: actor.tenantId,
                    shopId: actor.tenantId,
                    bridgeName: input.bridgeName,
                    now: new Date(),
                });
                if (!result.ok) {
                    const message =
                        result.reason === "expired"
                            ? "That pairing code is expired."
                            : result.reason === "used"
                              ? "That pairing code was already used."
                              : "That pairing code was not found.";
                    throw new ProductionError("BAD_REQUEST", message);
                }
                return { bridgeId: result.bridgeId, bridgeName: input.bridgeName.trim() };
            } catch (error) {
                rethrowProduction(error);
            }
        }),

    listBridgeDiscovery: protectedProcedure.query(async ({ ctx }) => {
        try {
            const { actor } = await scope(ctx);
            if (!actor.tenantId) return { candidates: [], lastTest: null };
            return await serverBridgeDirectory.listDiscovery(actor.tenantId);
        } catch (error) {
            rethrowProduction(error);
        }
    }),

    requestPrinterConnectionTest: protectedProcedure
        .input(z.object({ bridgeId: z.string().uuid(), address: z.string().min(1).max(500) }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { actor } = await scope(ctx);
                if (!actor.tenantId) throw new ProductionError("BAD_REQUEST", "A tenant is required.");
                const decision = productionAddressPolicy().decide(input.address);
                if (!decision.ok) throw new ProductionError("BAD_REQUEST", decision.reason);
                const probe = readOnlyInfoRequest(input.address, productionAddressPolicy());
                if ("error" in probe) throw new ProductionError("BAD_REQUEST", probe.error);
                if (probe.method !== "GET" || probe.url.pathname !== "/server/info") {
                    throw new ProductionError("BAD_REQUEST", "Connection test is read-only.");
                }
                const result = await serverBridgeDirectory.requestConnectionTest({
                    tenantId: actor.tenantId,
                    bridgeId: input.bridgeId,
                    address: input.address,
                    now: new Date(),
                });
                if (!result.ok) throw new ProductionError("BAD_REQUEST", result.reason);
                return {
                    pending: true as const,
                    address: result.address,
                    method: "GET" as const,
                    path: "/server/info" as const,
                };
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
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await registerMockPrinter(repo, actor, input);
            } catch (error) {
                rethrowProduction(error);
            }
        }),
});
