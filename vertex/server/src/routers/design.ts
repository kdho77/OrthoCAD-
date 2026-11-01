import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
    archiveDesignFile,
    createDesignFile,
    duplicateDesignFile,
    getDesignFile,
    listDesignFiles,
    redactDesignRow,
    restoreArchivedDesign,
    restoreDeletedDesign,
    softDeleteDesignFile,
    updateDesignMeta,
} from "../../../shared/client-files.js";
import { openClientFiles, rethrowClientFile } from "../lib/client-file-access.js";
import { designStateSchema } from "../lib/design-schema.js";
import { protectedProcedure, router } from "../trpc.js";

const designKind = z.enum(["insole", "afo"]);

async function scope(ctx: { user: { id: string; email: string; role: string } }) {
    return openClientFiles(ctx.user);
}

export const designRouter = router({
    list: protectedProcedure
        .input(z.object({ clientId: z.string().uuid(), includeDeleted: z.boolean().optional() }))
        .query(async ({ ctx, input }) => {
            try {
                const { repo, actor, storePhi } = await scope(ctx);
                const rows = await listDesignFiles(repo, actor, input.clientId, {
                    includeDeleted: input.includeDeleted,
                    storePhi,
                });
                return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
        try {
            const { repo, actor, storePhi } = await scope(ctx);
            await getDesignFile(repo, actor, input.id, storePhi);
            const document = await repo.loadDesignDocument(input.id);
            if (!document) throw new TRPCError({ code: "NOT_FOUND" });
            if (!storePhi && typeof document === "object") {
                return { ...(document as Record<string, unknown>), notes: "" };
            }
            return document;
        } catch (error) {
            rethrowClientFile(error);
        }
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
                const { repo, actor, storePhi } = await scope(ctx);
                return await updateDesignMeta(
                    repo,
                    actor,
                    input.id,
                    {
                        name: input.name,
                        notes: input.notes,
                    },
                    { storePhi },
                );
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    duplicate: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor, storePhi } = await scope(ctx);
                return await duplicateDesignFile(repo, actor, input.id, { storePhi });
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    archive: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor, storePhi } = await scope(ctx);
                return redactDesignRow(await archiveDesignFile(repo, actor, input.id), storePhi);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    restoreArchive: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor, storePhi } = await scope(ctx);
                return redactDesignRow(await restoreArchivedDesign(repo, actor, input.id), storePhi);
            } catch (error) {
                rethrowClientFile(error);
            }
        }),

    restore: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor, storePhi } = await scope(ctx);
                return redactDesignRow(await restoreDeletedDesign(repo, actor, input.id), storePhi);
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
                const { repo, actor, storePhi } = await scope(ctx);
                await getDesignFile(repo, actor, input.id, storePhi);
                const { state } = input;
                return await repo.saveDesignGeometry({
                    userId: ctx.user.id,
                    designId: input.id,
                    name: input.name,
                    pattern: state.pattern,
                    method: state.method,
                    thicknessMm: state.thicknessMm,
                    unit: state.corrections.unit,
                    linked: state.corrections.linked,
                    corrections: {
                        left: state.corrections.left,
                        right: state.corrections.right,
                    },
                    elements: state.elements,
                    ip: ctx.ip,
                });
            } catch (error) {
                rethrowClientFile(error);
            }
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
