// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// CAD-operator productions are created before loft and slice. The human
// generateSolid path does not use this module.

import { createHash, randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { waitUntil } from "@vercel/functions";
import {
    gyroidInfillPctForHardness,
    PrintRecipeProfileRequiredError,
    type PrintRecipeV1,
    resolveGyroidManufacturingPrintRecipe,
} from "../../../shared/print-recipe/print-recipe.js";

/** Pro serverless cap. waitUntil work is still inside this budget. */
export const CAD_PRODUCTION_MAX_DURATION_SEC = 300;

/** Reserve before the platform maxDuration so slice can fail and mark the production failed. */
export const CAD_VERTEX_SLICE_SAFETY_BUFFER_SEC = 20;

/** Upper bound on a single POST /v1/slice fetch wait. */
export const CAD_VERTEX_SLICE_MAX_TIMEOUT_SEC = 240;

/** Longer than maxDuration so a live invocation is not stolen before the platform stops it. */
export const CAD_PRODUCTION_LEASE_MS = (CAD_PRODUCTION_MAX_DURATION_SEC + 60) * 1000;

/**
 * Remaining invocation time for VertexSlice slice, capped at CAD_VERTEX_SLICE_MAX_TIMEOUT_SEC.
 * Uses the generateSolid / executeCadOperatorProduction start timestamp.
 */
export function cadVertexSliceSliceTimeoutMs(invocationStartedAt: Date, now: Date): number {
    const elapsedMs = Math.max(0, now.getTime() - invocationStartedAt.getTime());
    const budgetMs =
        (CAD_PRODUCTION_MAX_DURATION_SEC - CAD_VERTEX_SLICE_SAFETY_BUFFER_SEC) * 1000 - elapsedMs;
    const cappedMs = Math.min(budgetMs, CAD_VERTEX_SLICE_MAX_TIMEOUT_SEC * 1000);
    return Math.max(1, cappedMs);
}

export const HYBRID_GCODE_COST = 3;

export const CAD_PRODUCTION_STATUSES = ["pending", "running", "succeeded", "failed"] as const;

export type CadProductionStatus = (typeof CAD_PRODUCTION_STATUSES)[number];

export type CadFootSide = "left" | "right";

export interface CadProductionRow {
    id: string;
    designId: string;
    side: CadFootSide | null;
    presetId: string;
    status: CadProductionStatus;
    idempotencyKey: string;
    settingsFingerprint: string;
    gcodeStorageKey: string | null;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
    leaseExpiresAt: Date | null;
    chargedAt: Date | null;
    exportId: string | null;
    method: "printing_solid";
    beltAngleDeg: number;
    layerHeightMm: number | null;
    material: string;
}

export interface CadProductionInsert {
    designId: string;
    side: CadFootSide;
    presetId: string;
    idempotencyKey: string;
    settingsFingerprint: string;
    beltAngleDeg: number;
    layerHeightMm: number | null;
    material: string;
}

export interface CadProductionPatch {
    status?: CadProductionStatus;
    error?: string | null;
    gcodeStorageKey?: string | null;
    updatedAt?: Date;
    leaseExpiresAt?: Date | null;
    chargedAt?: Date | null;
    exportId?: string | null;
}

/**
 * Primitive store. claimProduction serializes decisions through updateIf.
 * Prisma uses SELECT FOR UPDATE inside updateIf. The memory store uses a mutex.
 */
export interface CadProductionStore {
    insert(row: CadProductionRow): Promise<CadProductionRow>;
    findById(id: string): Promise<CadProductionRow | null>;
    findByKey(idempotencyKey: string): Promise<CadProductionRow | null>;
    updateIf(
        id: string,
        predicate: (row: CadProductionRow) => boolean,
        patch: CadProductionPatch,
    ): Promise<CadProductionRow | null>;
    listByDesign(
        designId: string,
        filter: { side?: CadFootSide; presetId?: string },
    ): Promise<CadProductionRow[]>;
}

export class UniqueIdempotencyError extends Error {
    constructor() {
        super("idempotency key already exists");
        this.name = "UniqueIdempotencyError";
    }
}

export function isLeaseExpired(row: CadProductionRow, now: Date): boolean {
    if (row.status !== "pending" && row.status !== "running") return false;
    if (!row.leaseExpiresAt) return false;
    return row.leaseExpiresAt.getTime() <= now.getTime();
}

export function decideClaim(existing: CadProductionRow | null, now: Date): "insert" | "reuse" | "rerun" {
    if (!existing) return "insert";
    if (existing.status === "succeeded") return "reuse";
    if (existing.status === "failed") return "rerun";
    if (isLeaseExpired(existing, now)) return "rerun";
    return "reuse";
}

function leaseDeadline(now: Date): Date {
    return new Date(now.getTime() + CAD_PRODUCTION_LEASE_MS);
}

function newPending(input: CadProductionInsert, now: Date): CadProductionRow {
    return {
        id: randomUUID(),
        designId: input.designId,
        side: input.side,
        presetId: input.presetId,
        status: "pending",
        idempotencyKey: input.idempotencyKey,
        settingsFingerprint: input.settingsFingerprint,
        gcodeStorageKey: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        leaseExpiresAt: leaseDeadline(now),
        chargedAt: null,
        exportId: null,
        method: "printing_solid",
        beltAngleDeg: input.beltAngleDeg,
        layerHeightMm: input.layerHeightMm,
        material: input.material,
    };
}

export async function claimProduction(
    store: CadProductionStore,
    input: CadProductionInsert,
    now: Date,
): Promise<{ row: CadProductionRow; run: boolean }> {
    const existing = await store.findByKey(input.idempotencyKey);
    if (decideClaim(existing, now) === "insert") {
        try {
            const row = await store.insert(newPending(input, now));
            return { row, run: true };
        } catch (error) {
            if (!(error instanceof UniqueIdempotencyError)) throw error;
        }
    }
    const current = existing ?? (await store.findByKey(input.idempotencyKey));
    if (!current) throw new Error("idempotency claim failed");
    if (decideClaim(current, now) === "reuse") return { row: current, run: false };
    const updated = await store.updateIf(current.id, (row) => decideClaim(row, now) === "rerun", {
        status: "pending",
        error: null,
        leaseExpiresAt: leaseDeadline(now),
        updatedAt: now,
        gcodeStorageKey: current.chargedAt ? current.gcodeStorageKey : null,
    });
    if (!updated) {
        const latest = await store.findById(current.id);
        if (!latest) throw new Error("idempotency claim failed");
        return { row: latest, run: false };
    }
    return { row: updated, run: true };
}

export async function expireStaleProduction(
    store: CadProductionStore,
    id: string,
    now: Date,
): Promise<CadProductionRow | null> {
    const row = await store.findById(id);
    if (!row) return null;
    if (!isLeaseExpired(row, now)) return row;
    const updated = await store.updateIf(id, (current) => isLeaseExpired(current, now), {
        status: "failed",
        error: "Production lease expired",
        updatedAt: now,
        leaseExpiresAt: null,
    });
    return updated ?? (await store.findById(id));
}

export function publicProductionError(error: unknown): string {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("Canonical Export mesh is not available headless")) {
        return "Canonical Export mesh is not available headless. Refusing to substitute a different mesh.";
    }
    const allowed = [
        "Insufficient export tokens",
        "No valid license",
        "Manufacturing service returned empty output",
        "Production lease expired",
        "CAD-operator manufacturing returns G-code only",
        "Invalid manufacturing STL storage key",
        "Milled orders are not belt G-code",
        "Storage not available",
        "Supabase admin client not configured",
        "Manufacturing charge failed",
    ];
    if (message.startsWith("VertexSlice timed out after")) {
        return message;
    }
    for (const item of allowed) {
        if (message === item || message.startsWith(`${item}:`) || message.startsWith(`${item} `)) {
            return item;
        }
    }
    return "Manufacturing failed";
}

const ASSET_LOAD_CAUSE =
    /\/fonts\/|Inter-Bold|\/elements\/|Element asset|Failed to parse URL|failed to (?:load|parse) /;

/**
 * Log-only inner cause. Font, element, and URL failures.
 * A patient name or settings payload is not returned.
 */
export function assetLoadCauseForLog(error: unknown): string | null {
    const messages: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        messages.push(current.message);
        current = current.cause;
    }
    for (const message of messages) {
        const wrapped = message.match(
            /^Canonical Export mesh is not available headless \(([\s\S]*)\)\. Refusing to substitute a different mesh\.$/,
        );
        const candidate = (wrapped?.[1] ?? message).trim();
        if (!candidate || candidate.length > 500) continue;
        if (/settingsJson|firstName|lastName|patientName|"settings"/i.test(candidate)) continue;
        if (ASSET_LOAD_CAUSE.test(candidate)) return candidate;
    }
    return null;
}

export interface PublicProduction {
    productionId: string;
    designId: string;
    side: CadFootSide | null;
    presetId: string;
    status: CadProductionStatus;
    createdAt: string;
    updatedAt: string;
    gcodeStorageKey: string | null;
    error: string | null;
    download: { tool: "get_export_download"; productionId: string } | null;
}

export function toPublicProduction(row: CadProductionRow): PublicProduction {
    const ready = row.status === "succeeded" && Boolean(row.gcodeStorageKey);
    return {
        productionId: row.id,
        designId: row.designId,
        side: row.side,
        presetId: row.presetId,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        gcodeStorageKey: row.gcodeStorageKey,
        error: row.error,
        download: ready ? { tool: "get_export_download", productionId: row.id } : null,
    };
}

function stableStringify(value: unknown): string {
    if (value === undefined) return "null";
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function cadOperatorManufacturingIdentity(input: {
    designId: string;
    side: CadFootSide;
    presetId: string;
    useSavedDesignMesh: boolean;
    material: string;
    beltAngleDeg: number;
    layerHeightMm: number | null;
    printRecipe: unknown;
    settingsJson: unknown;
    stlStorageKey: string | null;
}): { fingerprint: string; idempotencyKey: string } {
    const fingerprint = createHash("sha256")
        .update(
            stableStringify({
                version: 1,
                designId: input.designId,
                side: input.side,
                presetId: input.presetId,
                useSavedDesignMesh: input.useSavedDesignMesh,
                material: input.material,
                beltAngleDeg: input.beltAngleDeg,
                layerHeightMm: input.layerHeightMm,
                printRecipe: input.printRecipe,
                settingsJson: input.settingsJson,
                stlStorageKey: input.useSavedDesignMesh ? null : input.stlStorageKey,
            }),
        )
        .digest("hex");
    const idempotencyKey = `cadop:v1:${input.designId}:${input.side}:${input.presetId}:${fingerprint}`;
    return { fingerprint, idempotencyKey };
}

/** Same gyroid percent the session path sends. Hard on the locked profile is 32. */
export function infillPctForCadSlice(presetId: string, printRecipe: PrintRecipeV1): number {
    let resolved: PrintRecipeV1;
    try {
        resolved = resolveGyroidManufacturingPrintRecipe(presetId, printRecipe);
    } catch (error) {
        if (error instanceof PrintRecipeProfileRequiredError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
    }
    if (presetId !== resolved.profileId) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "presetId must match PrintRecipeV1.profileId for production gyroid manufacturing.",
        });
    }
    return gyroidInfillPctForHardness(resolved.defaultHardness, resolved.hardnessToInfillPct);
}

export interface CadChargeResult {
    exportId: string;
    balance: number;
    alreadyCharged: boolean;
}

export interface CadProductionSliceContext {
    sliceTimeoutMs: number;
    sliceTimeoutSec: number;
}

export interface ExecuteCadProductionArgs {
    row: CadProductionRow;
    store: CadProductionStore;
    now: () => Date;
    materialize: () => Promise<{ stlStorageKey: string; meshFingerprint: string | null }>;
    slice: (
        stlStorageKey: string,
        ctx?: CadProductionSliceContext,
    ) => Promise<{ gcode: string; jobId: string }>;
    uploadGcode: (gcode: string) => Promise<{ storageKey: string }>;
    charge: (args: {
        storageKey: string;
        jobId: string;
        meshFingerprint: string | null;
    }) => Promise<CadChargeResult>;
    archiveTemp?: (args: { stlStorageKey: string; exportId: string }) => Promise<void>;
    deleteTemp?: (stlStorageKey: string) => Promise<void>;
}

async function markFailed(store: CadProductionStore, id: string, error: unknown, now: Date): Promise<void> {
    await store.updateIf(id, (row) => row.status === "pending" || row.status === "running", {
        status: "failed",
        error: publicProductionError(error),
        updatedAt: now,
        leaseExpiresAt: null,
    });
}

export async function executeCadOperatorProduction(args: ExecuteCadProductionArgs): Promise<void> {
    const started = args.now();
    let stlStorageKey: string | null = null;
    try {
        const running = await args.store.updateIf(
            args.row.id,
            (row) => row.status === "pending" || row.status === "running",
            {
                status: "running",
                leaseExpiresAt: leaseDeadline(started),
                updatedAt: started,
                error: null,
            },
        );
        if (!running) return;

        const current = await args.store.findById(args.row.id);
        if (current?.chargedAt && current.gcodeStorageKey) {
            await args.store.updateIf(args.row.id, (row) => row.status !== "succeeded", {
                status: "succeeded",
                gcodeStorageKey: current.gcodeStorageKey,
                error: null,
                updatedAt: args.now(),
                leaseExpiresAt: null,
            });
            return;
        }

        const materialized = await args.materialize();
        stlStorageKey = materialized.stlStorageKey;
        const sliceNow = args.now();
        const sliceTimeoutMs = cadVertexSliceSliceTimeoutMs(started, sliceNow);
        const sliceTimeoutSec = Math.max(1, Math.ceil(sliceTimeoutMs / 1000));
        const sliced = await args.slice(stlStorageKey, { sliceTimeoutMs, sliceTimeoutSec });
        if (!sliced.gcode) {
            throw new Error("Manufacturing service returned empty output");
        }
        const uploaded = await args.uploadGcode(sliced.gcode);
        const charged = await args.charge({
            storageKey: uploaded.storageKey,
            jobId: sliced.jobId,
            meshFingerprint: materialized.meshFingerprint,
        });
        await args.store.updateIf(args.row.id, () => true, {
            chargedAt: args.now(),
            exportId: charged.exportId,
            gcodeStorageKey: uploaded.storageKey,
            updatedAt: args.now(),
        });
        if (args.archiveTemp && stlStorageKey) {
            try {
                await args.archiveTemp({ stlStorageKey, exportId: charged.exportId });
            } catch (error) {
                console.error("[manufacturing] archive after charge failed", {
                    message: publicProductionError(error),
                });
            }
        }
        await args.store.updateIf(args.row.id, (row) => row.status !== "succeeded", {
            status: "succeeded",
            gcodeStorageKey: uploaded.storageKey,
            error: null,
            updatedAt: args.now(),
            leaseExpiresAt: null,
        });
    } catch (error) {
        if (stlStorageKey && args.deleteTemp) {
            try {
                await args.deleteTemp(stlStorageKey);
            } catch {
                // Temp STL expires by the existing TTL job.
            }
        }
        await markFailed(args.store, args.row.id, error, args.now());
        console.error("[manufacturing] cad production failed", {
            productionId: args.row.id,
            message: publicProductionError(error),
        });
        const assetCause = assetLoadCauseForLog(error);
        if (assetCause) console.error(assetCause);
    }
}

export async function beginCadOperatorProduction(args: {
    store: CadProductionStore;
    insert: CadProductionInsert;
    now: Date;
    schedule: (work: Promise<void>) => void;
    preflight?: () => Promise<void>;
    execute: (row: CadProductionRow) => Promise<void>;
}): Promise<{ productionId: string; status: CadProductionStatus; side: CadFootSide }> {
    const claimed = await claimProduction(args.store, args.insert, args.now);
    if (!claimed.run) {
        const visible = (await expireStaleProduction(args.store, claimed.row.id, args.now)) ?? claimed.row;
        return { productionId: visible.id, status: visible.status, side: args.insert.side };
    }
    if (args.preflight) {
        try {
            await args.preflight();
        } catch (error) {
            await markFailed(args.store, claimed.row.id, error, args.now);
            return { productionId: claimed.row.id, status: "failed", side: args.insert.side };
        }
    }
    const work = args.execute(claimed.row);
    args.schedule(work);
    return { productionId: claimed.row.id, status: "pending", side: args.insert.side };
}

/**
 * Hold the invocation open after the tRPC response. Outside a Vercel request
 * this is a no-op and the Node process keeps the promise on the event loop.
 */
export function scheduleCadProduction(work: Promise<void>): void {
    const guarded = work.catch((error: unknown) => {
        console.error("[manufacturing] background production failed", {
            message: publicProductionError(error),
        });
    });
    waitUntil(guarded);
}

function cloneRow(row: CadProductionRow): CadProductionRow {
    return {
        ...row,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt) : null,
        chargedAt: row.chargedAt ? new Date(row.chargedAt) : null,
    };
}

/** In-process store for tests. Mutations share one mutex so concurrent claims collide once. */
export class MemoryCadProductionStore implements CadProductionStore {
    private readonly rows = new Map<string, CadProductionRow>();
    private queue: Promise<unknown> = Promise.resolve();

    private lock<T>(fn: () => T): Promise<T> {
        const run = this.queue.then(() => fn());
        this.queue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    insert(row: CadProductionRow): Promise<CadProductionRow> {
        return this.lock(() => {
            for (const existing of this.rows.values()) {
                if (existing.idempotencyKey === row.idempotencyKey) throw new UniqueIdempotencyError();
            }
            this.rows.set(row.id, cloneRow(row));
            return cloneRow(row);
        });
    }

    findById(id: string): Promise<CadProductionRow | null> {
        return this.lock(() => {
            const row = this.rows.get(id);
            return row ? cloneRow(row) : null;
        });
    }

    findByKey(idempotencyKey: string): Promise<CadProductionRow | null> {
        return this.lock(() => {
            for (const existing of this.rows.values()) {
                if (existing.idempotencyKey === idempotencyKey) return cloneRow(existing);
            }
            return null;
        });
    }

    updateIf(
        id: string,
        predicate: (row: CadProductionRow) => boolean,
        patch: CadProductionPatch,
    ): Promise<CadProductionRow | null> {
        return this.lock(() => {
            const row = this.rows.get(id);
            if (!row || !predicate(row)) return null;
            const next = cloneRow({ ...row, ...patch });
            this.rows.set(id, next);
            return cloneRow(next);
        });
    }

    listByDesign(
        designId: string,
        filter: { side?: CadFootSide; presetId?: string },
    ): Promise<CadProductionRow[]> {
        return this.lock(() => {
            const rows = [...this.rows.values()].filter((row) => {
                if (row.designId !== designId) return false;
                if (filter.side && row.side !== filter.side) return false;
                if (filter.presetId && row.presetId !== filter.presetId) return false;
                return true;
            });
            rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return rows.map(cloneRow);
        });
    }
}
