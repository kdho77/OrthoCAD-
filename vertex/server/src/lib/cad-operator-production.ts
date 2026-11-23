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

/** Same token cost as export.authorize format "stl" (vertex/server/src/routers/export.ts). */
export const CENTRAL_FAB_STL_COST = 1;

/** Same token cost as export.authorize format "gcode" (vertex/server/src/routers/export.ts). */
export const CNC_GCODE_COST = 2;

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
    /** Null is one pair file (both feet). A single-foot order stores that foot. */
    side: CadFootSide | null;
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
    createdAt?: Date;
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
    findInFlightByFingerprint(
        designId: string,
        side: CadFootSide,
        presetId: string,
        settingsFingerprint: string,
        now: Date,
    ): Promise<CadProductionRow | null>;
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

export function freshSliceIdempotencyKey(canonicalKey: string): string {
    return `${canonicalKey}:fresh:${randomUUID()}`;
}

function isInFlight(row: CadProductionRow, now: Date): boolean {
    return (row.status === "pending" || row.status === "running") && !isLeaseExpired(row, now);
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
    options?: { forceNewSlice?: boolean },
): Promise<{ row: CadProductionRow; run: boolean }> {
    const forceNewSlice = options?.forceNewSlice === true;
    let claimInput = input;
    if (forceNewSlice) {
        const canonical = await store.findByKey(input.idempotencyKey);
        if (canonical && isInFlight(canonical, now)) {
            return { row: canonical, run: false };
        }
        const inFlight = await store.findInFlightByFingerprint(
            input.designId,
            input.side,
            input.presetId,
            input.settingsFingerprint,
            now,
        );
        if (inFlight) {
            return { row: inFlight, run: false };
        }
        if (canonical?.status === "succeeded") {
            claimInput = { ...input, idempotencyKey: freshSliceIdempotencyKey(input.idempotencyKey) };
        }
    }

    const existing = await store.findByKey(claimInput.idempotencyKey);
    if (decideClaim(existing, now) === "insert") {
        try {
            const row = await store.insert(newPending(claimInput, now));
            return { row, run: true };
        } catch (error) {
            if (!(error instanceof UniqueIdempotencyError)) throw error;
        }
    }
    const current = existing ?? (await store.findByKey(claimInput.idempotencyKey));
    if (!current) throw new Error("idempotency claim failed");
    if (decideClaim(current, now) === "reuse") return { row: current, run: false };
    const failedRetry = current.status === "failed";
    const updated = await store.updateIf(current.id, (row) => decideClaim(row, now) === "rerun", {
        status: "pending",
        error: null,
        leaseExpiresAt: leaseDeadline(now),
        updatedAt: now,
        ...(failedRetry
            ? {
                  createdAt: now,
                  gcodeStorageKey: null,
                  chargedAt: null,
                  exportId: null,
              }
            : {
                  gcodeStorageKey: current.chargedAt ? current.gcodeStorageKey : null,
              }),
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

const CANONICAL_EXPORT_REFUSAL =
    "Canonical Export mesh is not available headless. Refusing to substitute a different mesh.";
const CANONICAL_EXPORT_PREFIX = "Canonical Export mesh is not available headless";

/** Full server log, including cause stacks. The public row stores publicProductionError instead. */
export function productionErrorStack(error: unknown): string {
    const parts: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        parts.push(current.stack ?? `${current.name}: ${current.message}`);
        current = current.cause;
    }
    return parts.length > 0 ? parts.join("\nCaused by: ") : String(error);
}

function errorClassName(error: Error): string {
    const name = error.name?.trim();
    return name || "Error";
}

const PUBLIC_PRODUCTION_ERROR_MAX = 200;

function capPublicProductionMessage(text: string): string {
    if (text.length <= PUBLIC_PRODUCTION_ERROR_MAX) return text;
    return `${text.slice(0, PUBLIC_PRODUCTION_ERROR_MAX - 1)}…`;
}

/** Sanitized fragment for a production row. Strips PHI, secrets, URLs, and paths. */
function sanitizePublicFragment(raw: string): string {
    let text = raw.replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (/settingsJson|firstName|lastName|patientName|"settings"/i.test(text)) return "";
    text = text.length > 400 ? `${text.slice(0, 240)}…` : text;
    text = text.replace(/https?:\/\/\S+/gi, "[redacted]");
    text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]");
    text = text.replace(
        /\b(?:bearer|token|secret|password|api[_-]?key)\b\s*[:=]?\s*\S+|\bocad_[A-Za-z0-9._-]+|\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+\b/gi,
        "[redacted]",
    );
    text = text.replace(/\b[A-Z][a-z]+(?:[ '][A-Z][a-z]+)+\b/g, "[redacted]");
    text = text.replace(/\/(?:home|Users)\/[^/\s]+/g, "/[redacted]");
    text = text.replace(/\s+/g, " ").trim();
    return text;
}

function manufacturingFailedWithSide(side: CadFootSide | null | undefined, reason?: string | null): string {
    const sideLabel = side?.trim();
    const prefix = sideLabel ? `Manufacturing failed (${sideLabel})` : "Manufacturing failed";
    const detail = reason ? sanitizePublicFragment(reason) : "";
    if (!detail || detail === "[redacted]" || /^[\s[\]redacted…]+$/.test(detail)) return prefix;
    return capPublicProductionMessage(`${prefix}: ${detail}`);
}

function isUnclassifiedTimeoutMessage(message: string): boolean {
    if (message.startsWith("VertexSlice timed out after")) return false;
    return /(?:\btimeout\b|timed out|ETIMEDOUT|ECONNABORTED|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT)/i.test(
        message,
    );
}

function reasonForUnknownFailure(error: unknown, message: string): string | null {
    const inner = innerCauseForPublicError(error);
    if (inner) {
        const unlabeled = inner.replace(/^[A-Za-z0-9_]+:\s*/, "").trim();
        if (unlabeled) return unlabeled;
    }
    const sanitized = sanitizePublicFragment(message);
    return sanitized || null;
}

/** Class plus a short message. Drops names, settings payloads, file bodies, and secrets. */
function sanitizedInnerCause(name: string, message: string): string | null {
    const raw = message.replace(/\s+/g, " ").trim();
    if (!raw) return null;
    if (/settingsJson|firstName|lastName|patientName|"settings"/i.test(raw)) return null;
    if (/^[A-Z][a-z]+(?:[ '][A-Z][a-z]+){0,3}$/.test(raw)) return null;
    if (/facet normal|endsolid|^solid\s|(?:^|\s)(?:G0|G1|G90)\b/i.test(raw)) return null;
    const text = sanitizePublicFragment(raw);
    if (!text || text === "[redacted]" || /^[\s[\]redacted…]+$/.test(text)) return null;
    return `${name}: ${text}`;
}

function deepestNonRefusal(error: unknown): Error | null {
    const seen = new Set<unknown>();
    let current: unknown = error;
    let found: Error | null = null;
    while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        if (!current.message.startsWith(CANONICAL_EXPORT_PREFIX)) found = current;
        current = current.cause;
    }
    return found;
}

function innerCauseForPublicError(error: unknown): string | null {
    const deepest = deepestNonRefusal(error);
    if (deepest) {
        const labeled = sanitizedInnerCause(errorClassName(deepest), deepest.message);
        if (labeled) return labeled;
    }
    const message = error instanceof Error ? error.message : "";
    const wrapped = message.match(
        /^Canonical Export mesh is not available headless(?: \(([\s\S]*)\))?(?:\. Refusing to substitute a different mesh\.)?$/,
    );
    const inner = wrapped?.[1]?.trim() ?? "";
    if (!inner) return null;
    const labeled = inner.match(/^([A-Z][A-Za-z0-9_]*): ([\s\S]+)$/);
    if (labeled?.[1] && labeled[2]) return sanitizedInnerCause(labeled[1], labeled[2]);
    return sanitizedInnerCause("Error", inner);
}

export function publicProductionError(error: unknown, side?: CadFootSide | null): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(CANONICAL_EXPORT_PREFIX)) {
        const detail = innerCauseForPublicError(error);
        return detail ? `${CANONICAL_EXPORT_REFUSAL} (${detail})` : CANONICAL_EXPORT_REFUSAL;
    }
    const allowed = [
        "Insufficient export tokens",
        "No valid license",
        "Manufacturing service returned empty output",
        "Production lease expired",
        "CAD-operator manufacturing returns G-code only",
        "Invalid manufacturing STL storage key",
        "Invalid central-fab STL storage key",
        "Milled orders are not belt G-code",
        "Print orders are not CNC G-code",
        "No insole geometry to mill",
        "Design has no saved parameter snapshot",
        "Central-fab STL uses the milling solid",
        "Storage not available",
        "Supabase admin client not configured",
        "Manufacturing charge failed",
    ];
    if (
        message.startsWith("VertexSlice timed out after") ||
        message.startsWith("Manufacturing STL ") ||
        message.startsWith("Regional hardness")
    ) {
        return message;
    }
    if (message.startsWith("Manufacturing mesh is not sliceable")) {
        return message;
    }
    if (message === "VertexSlice returned empty G-code") {
        return message;
    }
    const vertexSliceError = message.match(/^VertexSlice error \((\d+)\):\s*(.*)$/s);
    if (vertexSliceError) {
        const status = vertexSliceError[1];
        const detail = sanitizePublicFragment(vertexSliceError[2] ?? "");
        return capPublicProductionMessage(
            detail ? `VertexSlice error (${status}): ${detail}` : `VertexSlice error (${status})`,
        );
    }
    const reach = message.match(/^Could not reach VertexSlice \([^)]*\):\s*(.*)$/s);
    if (reach) {
        const detail = sanitizePublicFragment(reach[1] ?? "");
        return capPublicProductionMessage(
            detail ? `Could not reach VertexSlice: ${detail}` : "Could not reach VertexSlice",
        );
    }
    if (message.startsWith("Material ") && message.includes("not available on slicer")) {
        const colon = message.indexOf(":");
        const base = colon >= 0 ? message.slice(0, colon).trim() : message;
        const tail = colon >= 0 ? message.slice(colon + 1).trim() : "";
        const detail = sanitizePublicFragment(tail);
        return capPublicProductionMessage(detail ? `${base}: ${detail}` : base);
    }
    for (const prefix of [
        "Hardness 3MF export failed",
        "manifold-3d rejected",
        "manifold-3d subtract failed",
        "3MF missing",
        "binary STL truncated",
    ] as const) {
        if (!message.startsWith(prefix)) continue;
        const after = message.slice(prefix.length);
        if (!after) return prefix;
        if (after.startsWith(": ")) {
            const detail = sanitizePublicFragment(after.slice(2));
            return capPublicProductionMessage(detail ? `${prefix}: ${detail}` : prefix);
        }
        return capPublicProductionMessage(sanitizePublicFragment(message));
    }
    if (side && isUnclassifiedTimeoutMessage(message)) {
        return `Manufacturing timed out (${side})`;
    }
    for (const item of allowed) {
        if (message === item || message.startsWith(`${item}:`) || message.startsWith(`${item} `)) {
            return item;
        }
    }
    return manufacturingFailedWithSide(side, reasonForUnknownFailure(error, message));
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
    /** Omitted keys keep the belt fingerprint. */
    deliverable?: "central_fab_stl" | "cnc_gcode";
    /** Feet inside one CNC file. Omitted for belt and central-fab. */
    millSides?: readonly CadFootSide[];
    /** Included only when true, so an off gate keeps today's fingerprint. */
    regional3mf?: boolean;
    /** Included only for RR/LL, so an omitted or LR mill keeps today's fingerprint. */
    millSide?: "RR" | "LL";
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
                ...(input.deliverable ? { deliverable: input.deliverable } : {}),
                ...(input.millSides ? { millSides: input.millSides } : {}),
                ...(input.regional3mf ? { regional3mf: true } : {}),
                ...(input.millSide ? { millSide: input.millSide } : {}),
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
    /** executeCadOperatorProduction start. Recompute the slice budget after STL download. */
    invocationStartedAt: Date;
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
    /**
     * The materialized STL is the deliverable. Slice and G-code upload are not called.
     * Belt productions leave this unset.
     */
    deliverMaterializedStl?: boolean;
}

async function markFailed(
    store: CadProductionStore,
    id: string,
    error: unknown,
    now: Date,
    side?: CadFootSide | null,
): Promise<void> {
    await store.updateIf(id, (row) => row.status === "pending" || row.status === "running", {
        status: "failed",
        error: publicProductionError(error, side),
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
        if (args.deliverMaterializedStl) {
            if (!stlStorageKey) throw new Error("Manufacturing service returned empty output");
            const charged = await args.charge({
                storageKey: stlStorageKey,
                jobId: `stl_${args.row.id}`,
                meshFingerprint: materialized.meshFingerprint,
            });
            await args.store.updateIf(args.row.id, () => true, {
                chargedAt: args.now(),
                exportId: charged.exportId,
                gcodeStorageKey: stlStorageKey,
                updatedAt: args.now(),
            });
            await args.store.updateIf(args.row.id, (row) => row.status !== "succeeded", {
                status: "succeeded",
                gcodeStorageKey: stlStorageKey,
                error: null,
                updatedAt: args.now(),
                leaseExpiresAt: null,
            });
            return;
        }
        const sliceNow = args.now();
        const sliceTimeoutMs = cadVertexSliceSliceTimeoutMs(started, sliceNow);
        const sliceTimeoutSec = Math.max(1, Math.ceil(sliceTimeoutMs / 1000));
        const sliced = await args.slice(stlStorageKey, {
            sliceTimeoutMs,
            sliceTimeoutSec,
            invocationStartedAt: started,
        });
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
        await markFailed(args.store, args.row.id, error, args.now(), args.row.side);
        console.error("[manufacturing] cad production failed", {
            productionId: args.row.id,
            message: publicProductionError(error, args.row.side),
            stack: productionErrorStack(error),
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
    forceNewSlice?: boolean;
}): Promise<{ productionId: string; status: CadProductionStatus; side: CadFootSide | null }> {
    const claimed = await claimProduction(args.store, args.insert, args.now, {
        forceNewSlice: args.forceNewSlice,
    });
    if (!claimed.run) {
        const visible = (await expireStaleProduction(args.store, claimed.row.id, args.now)) ?? claimed.row;
        return { productionId: visible.id, status: visible.status, side: args.insert.side };
    }
    if (args.preflight) {
        try {
            await args.preflight();
        } catch (error) {
            await markFailed(args.store, claimed.row.id, error, args.now, args.insert.side);
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

    findInFlightByFingerprint(
        designId: string,
        side: CadFootSide,
        presetId: string,
        settingsFingerprint: string,
        now: Date,
    ): Promise<CadProductionRow | null> {
        return this.lock(() => {
            for (const row of this.rows.values()) {
                if (row.designId !== designId || row.side !== side || row.presetId !== presetId) continue;
                if (row.settingsFingerprint !== settingsFingerprint) continue;
                if (isInFlight(row, now)) return cloneRow(row);
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
