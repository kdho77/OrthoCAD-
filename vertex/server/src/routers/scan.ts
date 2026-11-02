import { z } from "zod";
import { ClientFileError, getClientFile } from "../../../shared/client-files.js";
import {
    deleteClientScan,
    downloadClientScan,
    getClientScan,
    listClientScans,
    SCAN_BYTES_MAX,
    updateClientScan,
    uploadClientScan,
} from "../../../shared/client-scans.js";
import { openClientFiles } from "../lib/client-file-access.js";
import { openScans, rethrowScan } from "../lib/scan-access.js";
import { protectedProcedure, router } from "../trpc.js";

const side = z.enum(["left", "right"]);

function bytesFromBase64(value: string): Uint8Array {
    const bytes = Uint8Array.from(Buffer.from(value, "base64"));
    if (bytes.byteLength > SCAN_BYTES_MAX) {
        throw new ClientFileError("BAD_REQUEST", "Scan file is too large");
    }
    return bytes;
}

export const scanRouter = router({
    list: protectedProcedure
        .input(z.object({ clientId: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await openScans(ctx.user);
                const files = await openClientFiles(ctx.user);
                const client = await getClientFile(files.repo, files.actor, input.clientId);
                const rows = await listClientScans(repo, actor, client);
                return rows;
            } catch (error) {
                rethrowScan(error);
            }
        }),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await openScans(ctx.user);
            return await getClientScan(repo, actor, input.id);
        } catch (error) {
            rethrowScan(error);
        }
    }),

    upload: protectedProcedure
        .input(
            z.object({
                clientId: z.string().uuid(),
                side,
                fileName: z.string().min(1).max(180),
                contentType: z.string().max(120).optional(),
                bytesBase64: z
                    .string()
                    .min(1)
                    .max(Math.ceil(SCAN_BYTES_MAX * 1.4)),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await openScans(ctx.user);
                const files = await openClientFiles(ctx.user);
                const client = await getClientFile(files.repo, files.actor, input.clientId);
                return await uploadClientScan(repo, actor, {
                    client,
                    side: input.side,
                    fileName: input.fileName,
                    contentType: input.contentType ?? "application/octet-stream",
                    bytes: bytesFromBase64(input.bytesBase64),
                });
            } catch (error) {
                rethrowScan(error);
            }
        }),

    download: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await openScans(ctx.user);
            const file = await downloadClientScan(repo, actor, input.id);
            return {
                fileName: file.meta.fileName,
                contentType: file.meta.contentType,
                sha256: file.meta.sha256,
                bytesBase64: Buffer.from(file.bytes).toString("base64"),
            };
        } catch (error) {
            rethrowScan(error);
        }
    }),

    update: protectedProcedure
        .input(
            z.object({
                id: z.string().uuid(),
                side: side.optional(),
                fileName: z.string().min(1).max(180).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            try {
                const { repo, actor } = await openScans(ctx.user);
                return await updateClientScan(repo, actor, input.id, {
                    side: input.side,
                    fileName: input.fileName,
                });
            } catch (error) {
                rethrowScan(error);
            }
        }),

    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        try {
            const { repo, actor } = await openScans(ctx.user);
            return await deleteClientScan(repo, actor, input.id);
        } catch (error) {
            rethrowScan(error);
        }
    }),
});
