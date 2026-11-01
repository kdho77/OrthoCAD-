// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    migratePrintRecipe,
    type PrintRecipeV1,
    printRecipeToSnake,
} from "../../../shared/print-recipe/print-recipe.js";
import { callManufacture } from "./manufacturing-client.js";
import {
    archiveManufacturingSourceStl,
    deleteManufacturingTempBestEffort,
} from "./manufacturing-stl-lifecycle.js";
import type { InsertSliceJob, SettleSliceResult, SliceJobRecord, SliceLedger } from "./slice-ledger.js";
import type { SliceRuntime } from "./slice-orchestrator.js";
import { MANUFACTURING_BUCKET, signedDownloadUrl, uploadAsset } from "./storage.js";
import { getManufacturingSlicer, sliceWithVertexSlice } from "./vertexslice-client.js";

function asRecord(data: unknown): Record<string, unknown> | null {
    if (!data) return null;
    if (typeof data === "string") {
        try {
            return asRecord(JSON.parse(data));
        } catch {
            return null;
        }
    }
    if (Array.isArray(data)) return asRecord(data[0]);
    if (typeof data === "object") return data as Record<string, unknown>;
    return null;
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
    return error.code === "23505" || /duplicate key|slice_jobs_user_idempotency/i.test(error.message ?? "");
}

function rowToJob(row: Record<string, unknown>): SliceJobRecord {
    const request = row.request;
    return {
        id: String(row.id),
        userId: String(row.userId),
        idempotencyKey: String(row.idempotencyKey),
        status: row.status as SliceJobRecord["status"],
        designId: (row.designId as string | null) ?? null,
        stlUrl: (row.stlUrl as string | null) ?? null,
        stlStorageKey: (row.stlStorageKey as string | null) ?? null,
        profileId: String(row.profileId),
        material: (row.material as string | null) ?? null,
        side: (row.side as SliceJobRecord["side"]) ?? null,
        process: (row.process as string | null) ?? null,
        error: (row.error as string | null) ?? null,
        gcodeStorageKey: (row.gcodeStorageKey as string | null) ?? null,
        productionId: (row.productionId as string | null) ?? null,
        exportId: (row.exportId as string | null) ?? null,
        tokenCost: Number(row.tokenCost ?? 0),
        charged: Boolean(row.charged),
        balanceAfter: row.balanceAfter == null ? null : Number(row.balanceAfter),
        fileName: (row.fileName as string | null) ?? null,
        request: request && typeof request === "object" ? (request as Record<string, unknown>) : {},
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
    };
}

export class SupabaseSliceLedger implements SliceLedger {
    constructor(private readonly supabase: SupabaseClient) {}

    async getBalance(userId: string): Promise<number> {
        const { data, error } = await this.supabase
            .from("users")
            .select("tokenBalance")
            .eq("id", userId)
            .single();
        if (error || !data) throw new Error("User profile not found");
        return Number(data.tokenBalance);
    }

    async getById(jobId: string): Promise<SliceJobRecord | null> {
        const { data, error } = await this.supabase
            .from("slice_jobs")
            .select("*")
            .eq("id", jobId)
            .maybeSingle();
        if (error) throw new Error(`slice job lookup failed: ${error.message}`);
        if (!data) return null;
        return rowToJob(data as Record<string, unknown>);
    }

    async findByIdempotency(userId: string, idempotencyKey: string): Promise<SliceJobRecord | null> {
        const { data, error } = await this.supabase
            .from("slice_jobs")
            .select("*")
            .eq("userId", userId)
            .eq("idempotencyKey", idempotencyKey)
            .maybeSingle();
        if (error) throw new Error(`slice idempotency lookup failed: ${error.message}`);
        if (!data) return null;
        return rowToJob(data as Record<string, unknown>);
    }

    async insertQueued(input: InsertSliceJob): Promise<{ job: SliceJobRecord; created: boolean }> {
        const { data, error } = await this.supabase
            .from("slice_jobs")
            .insert({
                userId: input.userId,
                idempotencyKey: input.idempotencyKey,
                status: "queued",
                designId: input.designId ?? null,
                stlUrl: input.stlUrl ?? null,
                stlStorageKey: input.stlStorageKey ?? null,
                profileId: input.profileId,
                material: input.material ?? null,
                side: input.side ?? null,
                process: input.process ?? null,
                fileName: input.fileName ?? null,
                request: input.request ?? {},
                tokenCost: 0,
                charged: false,
            })
            .select("*")
            .single();
        if (error) {
            if (isUniqueViolation(error)) {
                const existing = await this.findByIdempotency(input.userId, input.idempotencyKey);
                if (existing) return { job: existing, created: false };
            }
            throw new Error(`slice job insert failed: ${error.message}`);
        }
        return { job: rowToJob(data as Record<string, unknown>), created: true };
    }

    async claimRunning(jobId: string): Promise<boolean> {
        const { data, error } = await this.supabase.rpc("vertex_claim_slice_job", { p_job_id: jobId });
        if (error) throw new Error(`slice claim failed: ${error.message}`);
        return Boolean(asRecord(data)?.claimed);
    }

    async touch(jobId: string): Promise<void> {
        const { error } = await this.supabase
            .from("slice_jobs")
            .update({ updatedAt: new Date().toISOString() })
            .eq("id", jobId)
            .eq("status", "running");
        if (error) throw new Error(`slice touch failed: ${error.message}`);
    }

    async markFailed(jobId: string, errorMessage: string): Promise<SliceJobRecord> {
        const { error } = await this.supabase.rpc("vertex_fail_slice_job", {
            p_job_id: jobId,
            p_error: errorMessage.slice(0, 500),
        });
        if (error) throw new Error(`slice fail failed: ${error.message}`);
        const job = await this.getById(jobId);
        if (!job) throw new Error("NOT_FOUND");
        return job;
    }

    async settleSuccess(
        jobId: string,
        patch: { gcodeStorageKey: string; fileName?: string | null },
    ): Promise<SettleSliceResult> {
        const { data, error } = await this.supabase.rpc("vertex_settle_slice_success", {
            p_job_id: jobId,
            p_gcode_storage_key: patch.gcodeStorageKey,
            p_file_name: patch.fileName ?? null,
            p_timeout_seconds: 600,
        });
        if (error) throw new Error(`slice settle failed: ${error.message}`);
        const payload = asRecord(data);
        const job = await this.getById(jobId);
        if (!job) throw new Error("NOT_FOUND");
        const balance = Number(payload?.balance ?? job.balanceAfter ?? 0);
        return { job, charged: Boolean(payload?.charged), balance };
    }
}

async function loadStlBytes(supabase: SupabaseClient, job: SliceJobRecord): Promise<Uint8Array> {
    if (job.stlStorageKey) {
        const { data, error } = await supabase.storage.from(MANUFACTURING_BUCKET).download(job.stlStorageKey);
        if (error || !data) throw new Error("Could not read manufacturing STL");
        return new Uint8Array(await data.arrayBuffer());
    }
    if (job.stlUrl) {
        const res = await fetch(job.stlUrl);
        if (!res.ok) throw new Error(`Could not download STL (${res.status})`);
        return new Uint8Array(await res.arrayBuffer());
    }
    throw new Error("Slice job has no STL");
}

function hardnessFromRequest(request: Record<string, unknown>): string | null {
    const recipe = request.printRecipe;
    if (!recipe || typeof recipe !== "object") return null;
    const hardness = (recipe as { defaultHardness?: unknown }).defaultHardness;
    return typeof hardness === "string" ? hardness : null;
}

export function createProductionSliceRuntime(supabase: SupabaseClient): SliceRuntime {
    const ledger = new SupabaseSliceLedger(supabase);
    return {
        ledger,
        loadStl: (job) => loadStlBytes(supabase, job),
        async slice(job, stl) {
            if (getManufacturingSlicer() === "legacy") {
                let stlUrl = job.stlUrl;
                if (!stlUrl && job.stlStorageKey) {
                    stlUrl = await signedDownloadUrl(supabase, job.stlStorageKey, 3600, MANUFACTURING_BUCKET);
                }
                if (!stlUrl) throw new Error("Legacy slicer requires an STL URL");
                const request = job.request;
                const belt = Number(request.beltAngleDeg ?? 45);
                const result = await callManufacture({
                    job_id: job.id,
                    design_id: job.designId ?? "adhoc",
                    preset_id: job.profileId,
                    stl_url: stlUrl,
                    output_type: "gcode",
                    belt_angle_deg: Number.isFinite(belt) ? belt : 45,
                    side: job.side,
                    layer_height_mm:
                        typeof request.layerHeightMm === "number" ? request.layerHeightMm : undefined,
                    perimeters: typeof request.perimeters === "number" ? request.perimeters : undefined,
                    grinding_style:
                        request.grindingStyle && typeof request.grindingStyle === "object"
                            ? (request.grindingStyle as { type: "straight" | "rounded" })
                            : undefined,
                    print_recipe:
                        request.printRecipe && typeof request.printRecipe === "object"
                            ? printRecipeToSnake(migratePrintRecipe(request.printRecipe as PrintRecipeV1))
                            : undefined,
                });
                return result.gcode ?? "";
            }
            return sliceWithVertexSlice({
                stl,
                profileId: job.profileId,
                material: job.material,
                hardness: hardnessFromRequest(job.request),
                fileName: job.fileName,
            });
        },
        async storeGcode(job, gcode) {
            const safe = (job.fileName || `slice-${job.profileId}.gcode`).replace(/[^a-zA-Z0-9_.-]/g, "_");
            const key = `gcode/${job.designId || "adhoc"}/${Date.now()}-${safe}`;
            await uploadAsset(supabase, key, Buffer.from(gcode, "utf8"), "text/plain", MANUFACTURING_BUCKET);
            return key;
        },
        signDownload: (key) => signedDownloadUrl(supabase, key, 3600, MANUFACTURING_BUCKET),
        async onSucceeded(job) {
            if (job.stlStorageKey && job.exportId) {
                await archiveManufacturingSourceStl(supabase, {
                    userId: job.userId,
                    exportId: job.exportId,
                    tempStlKey: job.stlStorageKey,
                });
            }
        },
        async onFailed(job) {
            deleteManufacturingTempBestEffort(supabase, job.stlStorageKey ?? undefined);
        },
    };
}
