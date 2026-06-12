// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    buildManufacturingArchiveStlKey,
    copyStorageObject,
    deleteAsset,
    deleteManufacturingTempBestEffort,
    MANUFACTURING_TEMP_PREFIX,
} from "./storage.js";

/**
 * After a successful manufacturing job, archive the submitted STL and remove the temp copy.
 * Failures are logged but do not fail the request.
 */
type ExportWriter = Pick<typeof import("../context.js").prisma, "export">;

export async function archiveManufacturingSourceStl(
    supabase: SupabaseClient,
    prisma: ExportWriter,
    opts: { userId: string; exportId: string; tempStlKey: string },
): Promise<void> {
    const archiveKey = buildManufacturingArchiveStlKey(opts.userId, opts.exportId);
    try {
        await copyStorageObject(supabase, opts.tempStlKey, archiveKey, "model/stl");
        await prisma.export.update({
            where: { id: opts.exportId },
            data: { sourceStlPath: archiveKey },
        });
        await deleteAsset(supabase, opts.tempStlKey);
        console.log("[manufacturing] archived source STL", {
            exportId: opts.exportId,
            archiveKey,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[manufacturing] FAILED to archive source STL — temp will expire via TTL job", {
            exportId: opts.exportId,
            tempStlKey: opts.tempStlKey,
            archiveKey,
            message,
        });
    }
}

export interface ManufacturingTempCleanupSummary {
    scanned: number;
    deleted: number;
    errors: string[];
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Delete manufacturing-temp objects older than `maxAgeHours` (by Storage `created_at`).
 */
export async function cleanupManufacturingTempObjects(
    supabase: SupabaseClient,
    maxAgeHours = 48,
    bucket = process.env.STORAGE_BUCKET ?? "vertex-assets",
): Promise<ManufacturingTempCleanupSummary> {
    const summary: ManufacturingTempCleanupSummary = { scanned: 0, deleted: 0, errors: [] };
    const cutoff = Date.now() - maxAgeHours * MS_PER_HOUR;

    const userFolders = await listAll(supabase, bucket, MANUFACTURING_TEMP_PREFIX.replace(/\/$/, ""));
    for (const folder of userFolders) {
        if (folder.id !== null) continue;
        const userPrefix = `${MANUFACTURING_TEMP_PREFIX}${folder.name}`;
        const files = await listAll(supabase, bucket, userPrefix);
        for (const file of files) {
            if (file.id === null || !file.name.endsWith(".stl")) continue;
            summary.scanned += 1;
            const key = `${userPrefix}/${file.name}`;
            const createdAt = file.created_at ? Date.parse(file.created_at) : Number.NaN;
            if (!Number.isFinite(createdAt)) {
                summary.errors.push(`missing created_at for ${key}`);
                continue;
            }
            if (createdAt >= cutoff) continue;
            try {
                await deleteAsset(supabase, key, bucket);
                summary.deleted += 1;
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                summary.errors.push(`${key}: ${message}`);
            }
        }
    }

    return summary;
}

interface ListedObject {
    name: string;
    id: string | null;
    created_at?: string;
}

async function listAll(supabase: SupabaseClient, bucket: string, prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    const pageSize = 100;
    let offset = 0;
    for (;;) {
        const { data, error } = await supabase.storage.from(bucket).list(prefix, {
            limit: pageSize,
            offset,
            sortBy: { column: "created_at", order: "asc" },
        });
        if (error) {
            throw new Error(`Storage list failed for ${prefix}: ${error.message}`);
        }
        if (!data?.length) break;
        for (const item of data) {
            out.push({ name: item.name, id: item.id, created_at: item.created_at ?? undefined });
        }
        if (data.length < pageSize) break;
        offset += pageSize;
    }
    return out;
}

export { deleteManufacturingTempBestEffort };
