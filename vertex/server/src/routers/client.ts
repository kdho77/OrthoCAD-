import { z } from "zod";
import {
    archiveClientFile,
    createClientFile,
    hardDeleteClientFile,
    listClientFiles,
    previewDuplicates,
    redactClientRow,
    restoreClientFile,
    updateClientFile,
} from "../../../shared/client-files.js";
import { openClientFiles, rethrowClientFile, storePhiEnabled } from "../lib/client-file-access.js";
import { protectedProcedure, router } from "../trpc.js";

const clientInput = z.object({
    displayName: z.string().max(120).nullable().optional(),
    firstName: z.string().max(100).optional().default(""),
    lastName: z.string().max(100).optional().default(""),
    reference: z.string().min(1).max(60),
    dateOfBirth: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
    mrn: z.string().max(60).nullable().optional(),
    email: z.string().email().nullable().optional().or(z.literal("")),
    phone: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
});

async function scope(ctx: { user: { id: string; email: string; role: string } }) {
    return openClientFiles(ctx.user);
}

export const clientRouter = router({
    policy: protectedProcedure.query(() => ({ storePhi: storePhiEnabled() })),

    list: protectedProcedure.query(async ({ ctx }) => {
        try {
            const { repo, actor, storePhi } = await scope(ctx);
            return await listClientFiles(repo, actor, { storePhi });
        } catch (error) {
            rethrowClientFile(error);
        }
    }),

    duplicates: protectedProcedure.input(clientInput).query(async ({ ctx, input }) => {
        try {
            const { repo, actor, storePhi } = await scope(ctx);
            return await previewDuplicates(repo, actor, input, undefined, storePhi);
        } catch (error) {
            rethrowClientFile(error);
        }
    }),

    create: protectedProcedure.input(clientInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor, storePhi } = await scope(ctx);
            return await createClientFile(repo, actor, input, { storePhi });
        } catch (error) {
            rethrowClientFile(error);
        }
    }),

    update: protectedProcedure
        .input(clientInput.partial().extend({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { id, ...patch } = input;
                const { repo, actor, storePhi } = await scope(ctx);
                return await updateClientFile(repo, actor, id, patch, { storePhi });
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    archive: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor, storePhi } = await scope(ctx);
                return redactClientRow(await archiveClientFile(repo, actor, input.id), storePhi);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    restore: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor, storePhi } = await scope(ctx);
                return redactClientRow(await restoreClientFile(repo, actor, input.id), storePhi);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    /** Archive is the default delete. Hard delete is `hardDelete`. */
    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            await archiveClientFile(repo, actor, input.id);
            return { ok: true as const };
        } catch (error) {
            rethrowClientFile(error);
        }
    }),

    hardDelete: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await hardDeleteClientFile(repo, actor, input.id);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),
});
