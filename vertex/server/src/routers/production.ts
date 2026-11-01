// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop jobs only. This router does not create or edit Vertex Orders.

import { z } from "zod";
import {
    assignJob,
    cancelJob,
    downloadGcode,
    enqueueJob,
    holdJob,
    listProduction,
    markJobDone,
    rerunJob,
    retryJob,
} from "../../../shared/production-jobs.js";
import { openProduction, rethrowProduction } from "../lib/production-access.js";
import { protectedProcedure, router } from "../trpc.js";

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
});
