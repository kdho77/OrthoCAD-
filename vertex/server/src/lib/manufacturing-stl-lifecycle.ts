// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    deleteAsset,
    GCODE_STORAGE_PREFIX,
    isManufacturingTempKey,
    MANUFACTURING_ARCHIVE_PREFIX,
    MANUFACTURING_BUCKET,
    MANUFACTURING_TEMP_PREFIX,
} from "./storage.js";

/** Sweep never keeps a manufacturing temp or G-code object longer than this. */
export const MANUFACTURING_SWEEP_MAX_AGE_HOURS = 24;

const MS_PER_HOUR = 60 * 60 * 1000;
const LIST_DEPTH_LIMIT = 8;

export interface ManufacturingTempCleanupSummary {
    scanned: number;
    deleted: number;
    errors: string[];
}

export interface StoredManufacturingInventory {
    manufacturingArchive: string[];
    staleManufacturingTemp: string[];
    staleGcode: string[];
}

/**
 * Dry-run plan for the inventory script. `--confirm` is recognized and still
 * does not delete. Existing-object removal is a separate approved step.
 */
export function storedManufacturingListPlan(argv: readonly string[]): {
    confirmRequested: boolean;
    deletes: false;
} {
    return {
        confirmRequested: argv.includes("--confirm"),
        deletes: false,
    };
}

function cappedSweepAgeHours(maxAgeHours: number): number {
    if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return MANUFACTURING_SWEEP_MAX_AGE_HOURS;
    return Math.min(maxAgeHours, MANUFACTURING_SWEEP_MAX_AGE_HOURS);
}

/**
 * Drop a temp STL after slice success or failure.
 * Does not copy to manufacturing-archive and does not write exports.sourceStlPath.
 */
export async function discardManufacturingTempStl(
    supabase: SupabaseClient | null | undefined,
    tempStlKey: string | undefined,
): Promise<void> {
    if (!supabase || !tempStlKey || !isManufacturingTempKey(tempStlKey)) return;
    try {
        await deleteAsset(supabase, tempStlKey, MANUFACTURING_BUCKET);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[manufacturing] failed to delete temp STL", { key: tempStlKey, message });
    }
}

/** Fire-and-forget wrapper kept for callers that must not await storage. */
export function deleteManufacturingTempBestEffort(
    supabase: SupabaseClient | null | undefined,
    key: string | undefined,
): void {
    void discardManufacturingTempStl(supabase, key);
}

export function isCadOperatorGcodeStorageKey(key: string): boolean {
    const trimmed = key.trim();
    return (
        trimmed.startsWith("gcode/cad-operator/") &&
        !trimmed.includes("..") &&
        !trimmed.includes("\\") &&
        !trimmed.includes("//")
    );
}

/**
 * Delete one cad-operator G-code object after VertexOrders attach is confirmed.
 * UI G-code (`gcode/{designId}/…`) stays until the sweep so the signed URL still works.
 */
export async function deleteCadOperatorGcodeAfterVoAttach(
    supabase: SupabaseClient | null | undefined,
    storageKey: string,
): Promise<boolean> {
    if (!supabase || !isCadOperatorGcodeStorageKey(storageKey)) return false;
    try {
        await deleteAsset(supabase, storageKey.trim(), MANUFACTURING_BUCKET);
        return true;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[manufacturing] failed to delete G-code after VO attach", {
            key: storageKey,
            message,
        });
        return false;
    }
}

/**
 * Delete manufacturing-temp and gcode objects older than `maxAgeHours`.
 * Age is capped at 24 hours. manufacturing-archive objects are left in place.
 */
export async function cleanupManufacturingTempObjects(
    supabase: SupabaseClient,
    maxAgeHours = MANUFACTURING_SWEEP_MAX_AGE_HOURS,
    bucket = MANUFACTURING_BUCKET,
    nowMs = Date.now(),
): Promise<ManufacturingTempCleanupSummary> {
    const summary: ManufacturingTempCleanupSummary = { scanned: 0, deleted: 0, errors: [] };
    const cutoff = nowMs - cappedSweepAgeHours(maxAgeHours) * MS_PER_HOUR;
    const objects = [
        ...(await collectStorageObjects(supabase, bucket, MANUFACTURING_TEMP_PREFIX)),
        ...(await collectStorageObjects(supabase, bucket, GCODE_STORAGE_PREFIX)),
    ];
    for (const object of objects) {
        summary.scanned += 1;
        if (object.createdAtMs === null) {
            summary.errors.push(`missing created_at for ${object.key}`);
            continue;
        }
        if (object.createdAtMs >= cutoff) continue;
        try {
            await deleteAsset(supabase, object.key, bucket);
            summary.deleted += 1;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            summary.errors.push(`${object.key}: ${message}`);
        }
    }
    return summary;
}

/**
 * List manufacturing-archive objects (any age) and stale manufacturing-temp
 * and gcode objects. Never deletes.
 */
export async function listStoredManufacturingFiles(
    supabase: SupabaseClient,
    maxAgeHours = MANUFACTURING_SWEEP_MAX_AGE_HOURS,
    bucket = MANUFACTURING_BUCKET,
    nowMs = Date.now(),
): Promise<StoredManufacturingInventory> {
    const cutoff = nowMs - cappedSweepAgeHours(maxAgeHours) * MS_PER_HOUR;
    const archive = await collectStorageObjects(supabase, bucket, MANUFACTURING_ARCHIVE_PREFIX);
    const temps = await collectStorageObjects(supabase, bucket, MANUFACTURING_TEMP_PREFIX);
    const gcode = await collectStorageObjects(supabase, bucket, GCODE_STORAGE_PREFIX);
    return {
        manufacturingArchive: archive.map((object) => object.key).sort(),
        staleManufacturingTemp: temps
            .filter((object) => object.createdAtMs !== null && object.createdAtMs < cutoff)
            .map((object) => object.key)
            .sort(),
        staleGcode: gcode
            .filter((object) => object.createdAtMs !== null && object.createdAtMs < cutoff)
            .map((object) => object.key)
            .sort(),
    };
}

interface ListedObject {
    name: string;
    id: string | null;
    created_at?: string;
}

interface StoredObject {
    key: string;
    createdAtMs: number | null;
}

async function collectStorageObjects(
    supabase: SupabaseClient,
    bucket: string,
    prefix: string,
): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    await walkStorage(supabase, bucket, prefix.replace(/\/$/, ""), 0, out);
    return out;
}

async function walkStorage(
    supabase: SupabaseClient,
    bucket: string,
    prefix: string,
    depth: number,
    out: StoredObject[],
): Promise<void> {
    if (depth > LIST_DEPTH_LIMIT) return;
    const items = await listAll(supabase, bucket, prefix);
    for (const item of items) {
        if (!item.name || item.name === ".emptyFolderPlaceholder" || item.name.includes("..")) continue;
        const key = `${prefix}/${item.name}`;
        if (item.id === null) {
            await walkStorage(supabase, bucket, key, depth + 1, out);
            continue;
        }
        const createdAtMs = item.created_at ? Date.parse(item.created_at) : Number.NaN;
        out.push({ key, createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null });
    }
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
