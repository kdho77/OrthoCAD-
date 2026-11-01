import { z } from "zod";
import {
    archiveClientFile,
    createClientFile,
    hardDeleteClientFile,
    listClientFiles,
    previewDuplicates,
    restoreClientFile,
    updateClientFile,
} from "../../../shared/client-files.js";
import { actorFor, rethrowClientFile, supabaseClientFileRepo } from "../lib/client-file-repo.js";
import { requireSupabaseAdmin } from "../lib/supabase-db.js";
import { protectedProcedure, router } from "../trpc.js";

const clientInput = z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    dateOfBirth: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
    reference: z.string().max(60).nullable().optional(),
    email: z.string().email().nullable().optional().or(z.literal("")),
    phone: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
});

async function scope(ctx: { user: { id: string; email: string; role: string } }) {
    const supabase = requireSupabaseAdmin();
    const repo = supabaseClientFileRepo(supabase);
    const actor = await actorFor(ctx.user, supabase);
    return { repo, actor };
}

export const clientRouter = router({
    list: protectedProcedure.query(async ({ ctx }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await listClientFiles(repo, actor);
        } catch (error) {
            rethrowClientFile(error);
        }
    }),

    duplicates: protectedProcedure.input(clientInput).query(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await previewDuplicates(repo, actor, input);
        } catch (error) {
            rethrowClientFile(error);
        }
    }),

    create: protectedProcedure.input(clientInput).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            return await createClientFile(repo, actor, input);
        } catch (error) {
            rethrowClientFile(error);
        }
    }),

    update: protectedProcedure
        .input(clientInput.partial().extend({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { id, ...patch } = input;
                const { repo, actor } = await scope(ctx);
                return await updateClientFile(repo, actor, id, patch);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    archive: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await archiveClientFile(repo, actor, input.id);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    restore: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await restoreClientFile(repo, actor, input.id);
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
