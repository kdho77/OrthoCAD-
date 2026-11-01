import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
    archiveDesignFile,
    createDesignFile,
    duplicateDesignFile,
    getDesignFile,
    listDesignFiles,
    restoreArchivedDesign,
    restoreDeletedDesign,
    softDeleteDesignFile,
    updateDesignMeta,
} from "../../../shared/client-files.js";
import { getSupabaseAdmin } from "../context.js";
import { actorFor, rethrowClientFile, supabaseClientFileRepo } from "../lib/client-file-repo.js";
import { designStateSchema } from "../lib/design-schema.js";
import { requireSupabaseAdmin } from "../lib/supabase-db.js";
import { protectedProcedure, router } from "../trpc.js";

const designKind = z.enum(["insole", "afo"]);

async function scope(ctx: { user: { id: string; email: string; role: string } }) {
    const supabase = requireSupabaseAdmin();
    return { supabase, repo: supabaseClientFileRepo(supabase), actor: await actorFor(ctx.user, supabase) };
}

export const designRouter = router({
    list: protectedProcedure
        .input(z.object({ clientId: z.string().uuid(), includeDeleted: z.boolean().optional() }))
        .query(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                const rows = await listDesignFiles(repo, actor, input.clientId, {
                    includeDeleted: input.includeDeleted,
                });
                return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
        const { supabase, repo, actor } = await scope(ctx);
        try {
            await getDesignFile(repo, actor, input.id);
        } catch (error) {
            rethrowClientFile(error);
        }
        const { data: design, error } = await supabase
            .from("designs")
            .select("*, corrections(*), elements(*)")
            .eq("id", input.id)
            .maybeSingle();

        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to load design: ${error.message}`,
            });
        }
        if (!design) throw new TRPCError({ code: "NOT_FOUND" });
        return design;
    }),

    create: protectedProcedure
        .input(
            z.object({
                clientId: z.string().uuid(),
                name: z.string().min(1).max(120),
                kind: designKind.optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await createDesignFile(repo, actor, {
                    clientId: input.clientId,
                    name: input.name,
                    kind: input.kind ?? "insole",
                });
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    updateMeta: protectedProcedure
        .input(
            z.object({
                id: z.string().uuid(),
                name: z.string().min(1).max(120).optional(),
                notes: z.string().max(500).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await updateDesignMeta(repo, actor, input.id, {
                    name: input.name,
                    notes: input.notes,
                });
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    duplicate: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await duplicateDesignFile(repo, actor, input.id);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    archive: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await archiveDesignFile(repo, actor, input.id);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    restoreArchive: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await restoreArchivedDesign(repo, actor, input.id);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    restore: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                return await restoreDeletedDesign(repo, actor, input.id);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    // Persists the full design: header fields + relational corrections + elements.
    save: protectedProcedure
        .input(
            z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), state: designStateSchema }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await scope(ctx);
                await getDesignFile(repo, actor, input.id);
            } catch (error) {
                rethrowClientFile(error);
            }
            const { state } = input;

            const adminClient = getSupabaseAdmin();
            if (!adminClient) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Supabase admin client not configured",
                });
            }

            const { data, error } = await adminClient.rpc("vertex_save_design", {
                p_user_id: ctx.user.id,
                p_design_id: input.id,
                p_name: input.name,
                p_pattern: state.pattern,
                p_method: state.method,
                p_thickness_mm: state.thicknessMm,
                p_unit: state.corrections.unit,
                p_linked: state.corrections.linked,
                p_corrections: {
                    left: state.corrections.left,
                    right: state.corrections.right,
                },
                p_elements: state.elements,
                p_ip: ctx.ip,
            });

            if (error) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Design save failed: ${error.message}`,
                });
            }

            return data as { ok: true };
        }),

    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await scope(ctx);
            await softDeleteDesignFile(repo, actor, input.id);
            return { ok: true as const };
        } catch (error) {
            rethrowClientFile(error);
        }
    }),
});
