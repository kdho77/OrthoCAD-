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
import {
    downloadVertexSliceJobResult,
    getVertexSliceJob,
    sliceWithVertexSlice,
    submitVertexSliceJob,
    type VertexSliceJobSnapshot,
    type VertexSliceRequest,
} from "./vertexslice-client.js";

/** Pro serverless cap. waitUntil work is still inside this budget. */
export const CAD_PRODUCTION_MAX_DURATION_SEC = 300;

/** Reserve before the platform maxDuration so slice can fail and mark the production failed. */
export const CAD_VERTEX_SLICE_SAFETY_BUFFER_SEC = 20;

/** Upper bound on a single POST /v1/slice fetch wait. The job path does not use this as slice time. */
export const CAD_VERTEX_SLICE_MAX_TIMEOUT_SEC = 240;

/** One Vercel invocation polls the slice job for at most this long. */
export const SLICE_JOB_POLL_BUDGET_MS = 60_000;

/** Pause between job status reads inside one invocation. */
export const SLICE_JOB_POLL_INTERVAL_MS = 5_000;

/** Queue time before started_at. It does not count toward the slice cap. */
export const SLICE_JOB_QUEUE_WAIT_CAP_MS = 20 * 60 * 1000;

/** Slice time from the server's started_at. Queue wait is not included. */
export const SLICE_JOB_SLICE_CAP_MS = 260_000;

/**
 * productions has no JSON column. The in-flight VertexSlice job id is JSON in
 * the existing error text and is removed from the public production payload.
 */
export const SLICE_CHECKPOINT_PREFIX = "slice-checkpoint:v1:";

export interface SliceCheckpointV1 {
    v: 1;
    jobId: string;
    acceptedAt: string;
    stlStorageKey: string;
    meshFingerprint: string | null;
    expectedRegionCount: number;
    credentialId: string;
    serverStartedAt: string | null;
}

export function encodeSliceCheckpoint(checkpoint: SliceCheckpointV1): string {
    return (
        SLICE_CHECKPOINT_PREFIX +
        JSON.stringify({
            v: 1,
            jobId: checkpoint.jobId,
            acceptedAt: checkpoint.acceptedAt,
            stlStorageKey: checkpoint.stlStorageKey,
            meshFingerprint: checkpoint.meshFingerprint,
            expectedRegionCount: checkpoint.expectedRegionCount,
            credentialId: checkpoint.credentialId,
            serverStartedAt: checkpoint.serverStartedAt,
        })
    );
}

export function readSliceCheckpoint(error: string | null | undefined): SliceCheckpointV1 | null {
    if (!error?.startsWith(SLICE_CHECKPOINT_PREFIX)) return null;
    try {
        const parsed = JSON.parse(error.slice(SLICE_CHECKPOINT_PREFIX.length)) as Partial<SliceCheckpointV1>;
        if (parsed.v !== 1 || typeof parsed.jobId !== "string" || !parsed.jobId.trim()) return null;
        if (typeof parsed.acceptedAt !== "string" || typeof parsed.stlStorageKey !== "string") return null;
        if (typeof parsed.credentialId !== "string") return null;
        return {
            v: 1,
            jobId: parsed.jobId,
            acceptedAt: parsed.acceptedAt,
            stlStorageKey: parsed.stlStorageKey,
            meshFingerprint: typeof parsed.meshFingerprint === "string" ? parsed.meshFingerprint : null,
            expectedRegionCount:
                typeof parsed.expectedRegionCount === "number" && parsed.expectedRegionCount > 0
                    ? parsed.expectedRegionCount
                    : 0,
            credentialId: parsed.credentialId,
            serverStartedAt: typeof parsed.serverStartedAt === "string" ? parsed.serverStartedAt : null,
        };
    } catch {
        return null;
    }
}

export function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.ref?.();
    });
}

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

function sliceJobStillOwned(row: CadProductionRow): boolean {
    return (row.status === "pending" || row.status === "running") && readSliceCheckpoint(row.error) !== null;
}

export function decideClaim(existing: CadProductionRow | null, now: Date): "insert" | "reuse" | "rerun" {
    if (!existing) return "insert";
    if (existing.status === "succeeded") return "reuse";
    if (existing.status === "failed") return "rerun";
    // A stored job id is resumed. A second generate must not submit another slice.
    if (sliceJobStillOwned(existing)) return "reuse";
    if (isLeaseExpired(existing, now)) return "rerun";
    return "reuse";
}

export function freshSliceIdempotencyKey(canonicalKey: string): string {
    return `${canonicalKey}:fresh:${randomUUID()}`;
}

function isInFlight(row: CadProductionRow, now: Date): boolean {
    if (row.status !== "pending" && row.status !== "running") return false;
    if (readSliceCheckpoint(row.error)) return true;
    return !isLeaseExpired(row, now);
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
    if (sliceJobStillOwned(row)) return row;
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
        message.startsWith("VertexSlice queue wait exceeded") ||
        message.startsWith("VertexSlice slice exceeded") ||
        message.startsWith("VertexSlice job lost") ||
        message.startsWith("Manufacturing STL ") ||
        message.startsWith("Regional hardness")
    ) {
        return capPublicProductionMessage(message);
    }
    if (message.startsWith("VertexSlice server error:")) {
        const detail = sanitizePublicFragment(message.slice("VertexSlice server error:".length));
        return capPublicProductionMessage(
            detail ? `VertexSlice server error: ${detail}` : "VertexSlice server error",
        );
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
        error: readSliceCheckpoint(row.error) ? null : row.error,
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
    checkpoint: SliceCheckpointV1 | null;
    meshFingerprint: string | null;
    budgetMs: number;
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    persistCheckpoint?: (checkpoint: SliceCheckpointV1) => Promise<void>;
}

export interface ExecuteCadProductionArgs {
    row: CadProductionRow;
    store: CadProductionStore;
    now: () => Date;
    materialize: () => Promise<{ stlStorageKey: string; meshFingerprint: string | null }>;
    slice: (
        stlStorageKey: string,
        ctx?: CadProductionSliceContext,
    ) => Promise<{ gcode: string; jobId: string } | { pending: true; checkpoint: SliceCheckpointV1 }>;
    /** Job-status polling cap for this invocation. Default is one minute. */
    sliceBudgetMs?: number;
    sleep?: (ms: number) => Promise<void>;
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

function roundSeconds(seconds: number): number {
    return Math.round(seconds * 1000) / 1000;
}

/** Wall-clock loft and slice. loft_s is materialize; slice_s is the VertexSlice call. */
function logCadOperatorTiming(row: CadProductionRow, loftS: number, sliceS: number): void {
    console.log(
        JSON.stringify({
            msg: "cad-operator-timing",
            productionId: row.id,
            side: row.side,
            loft_s: roundSeconds(loftS),
            slice_s: roundSeconds(sliceS),
        }),
    );
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
    let loftS = 0;
    let sliceS = 0;
    let timingStarted = false;
    let timingLogged = false;
    const logTiming = () => {
        if (!timingStarted || timingLogged) return;
        timingLogged = true;
        logCadOperatorTiming(args.row, loftS, sliceS);
    };
    try {
        const checkpoint = readSliceCheckpoint(
            (await args.store.findById(args.row.id))?.error ?? args.row.error,
        );
        const running = await args.store.updateIf(
            args.row.id,
            (row) => row.status === "pending" || row.status === "running",
            {
                status: "running",
                leaseExpiresAt: leaseDeadline(started),
                updatedAt: started,
                ...(checkpoint ? {} : { error: null }),
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

        let meshFingerprint: string | null = checkpoint?.meshFingerprint ?? null;
        timingStarted = true;
        if (checkpoint && !args.deliverMaterializedStl) {
            stlStorageKey = checkpoint.stlStorageKey;
        } else {
            const loftStarted = performance.now();
            try {
                const materialized = await args.materialize();
                stlStorageKey = materialized.stlStorageKey;
                meshFingerprint = materialized.meshFingerprint;
            } finally {
                loftS = (performance.now() - loftStarted) / 1000;
            }
        }
        if (!checkpoint && args.deliverMaterializedStl) {
            if (!stlStorageKey) throw new Error("Manufacturing service returned empty output");
            const charged = await args.charge({
                storageKey: stlStorageKey,
                jobId: `stl_${args.row.id}`,
                meshFingerprint,
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
            logTiming();
            return;
        }
        const sliceNow = args.now();
        const sliceTimeoutMs = cadVertexSliceSliceTimeoutMs(started, sliceNow);
        const sliceTimeoutSec = Math.max(1, Math.ceil(sliceTimeoutMs / 1000));
        const sliceStarted = performance.now();
        let sliced: Awaited<ReturnType<ExecuteCadProductionArgs["slice"]>>;
        try {
            sliced = await args.slice(stlStorageKey ?? "", {
                sliceTimeoutMs,
                sliceTimeoutSec,
                invocationStartedAt: started,
                checkpoint,
                meshFingerprint,
                budgetMs: args.sliceBudgetMs ?? SLICE_JOB_POLL_BUDGET_MS,
                now: args.now,
                sleep: args.sleep ?? sleepMs,
                persistCheckpoint: async (next) => {
                    await args.store.updateIf(
                        args.row.id,
                        (row) => row.status === "pending" || row.status === "running",
                        {
                            status: "running",
                            error: encodeSliceCheckpoint(next),
                            leaseExpiresAt: leaseDeadline(args.now()),
                            updatedAt: args.now(),
                        },
                    );
                },
            });
        } finally {
            sliceS = (performance.now() - sliceStarted) / 1000;
        }
        if ("pending" in sliced) {
            await args.store.updateIf(
                args.row.id,
                (row) => row.status === "pending" || row.status === "running",
                {
                    status: "running",
                    error: encodeSliceCheckpoint(sliced.checkpoint),
                    leaseExpiresAt: leaseDeadline(args.now()),
                    updatedAt: args.now(),
                },
            );
            logTiming();
            return;
        }
        if (!sliced.gcode) {
            throw new Error("Manufacturing service returned empty output");
        }
        const uploaded = await args.uploadGcode(sliced.gcode);
        const charged = await args.charge({
            storageKey: uploaded.storageKey,
            jobId: sliced.jobId,
            meshFingerprint,
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
        logTiming();
    } catch (error) {
        logTiming();
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

function sideSuffix(side: CadFootSide | null | undefined): string {
    return side ? ` (${side})` : "";
}

function isoMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

function queueWaitError(side: CadFootSide | null, waitedMs: number): Error {
    const waitedSec = Math.max(1, Math.floor(waitedMs / 1000));
    return new Error(`VertexSlice queue wait exceeded ${waitedSec}s${sideSuffix(side)}`);
}

function sliceTimeError(side: CadFootSide | null): Error {
    return new Error(`VertexSlice slice exceeded ${SLICE_JOB_SLICE_CAP_MS / 1000}s${sideSuffix(side)}`);
}

function serverJobError(side: CadFootSide | null, detail: string): Error {
    const text = detail.replace(/\s+/g, " ").trim() || "slice failed";
    return new Error(`VertexSlice server error: ${text}${sideSuffix(side)}`);
}

function jobLostError(side: CadFootSide | null): Error {
    return new Error(`VertexSlice job lost (404)${sideSuffix(side)}; retryable`);
}

function queueWaitMs(
    checkpoint: SliceCheckpointV1,
    job: VertexSliceJobSnapshot | null,
    nowMs: number,
): number {
    const queuedAt = isoMs(job?.queuedAt) ?? isoMs(checkpoint.acceptedAt) ?? nowMs;
    const end = job && job.status !== "queued" ? (isoMs(job.startedAt) ?? nowMs) : nowMs;
    return Math.max(0, end - queuedAt);
}

function sliceElapsedMs(
    checkpoint: SliceCheckpointV1,
    job: VertexSliceJobSnapshot | null,
    nowMs: number,
): number | null {
    if (job?.status === "queued") return null;
    const started = isoMs(job?.startedAt) ?? isoMs(checkpoint.serverStartedAt);
    if (started == null) {
        if (job?.elapsedS != null) return job.elapsedS * 1000;
        return null;
    }
    const fromClock = Math.max(0, nowMs - started);
    if (job?.elapsedS != null) return Math.max(fromClock, job.elapsedS * 1000);
    return fromClock;
}

function assertSliceCaps(
    checkpoint: SliceCheckpointV1,
    job: VertexSliceJobSnapshot | null,
    nowMs: number,
    side: CadFootSide | null,
): void {
    const sliceStarted = job
        ? job.status === "running" || job.status === "succeeded"
        : isoMs(checkpoint.serverStartedAt) != null;
    if (!sliceStarted && queueWaitMs(checkpoint, job, nowMs) >= SLICE_JOB_QUEUE_WAIT_CAP_MS) {
        throw queueWaitError(side, queueWaitMs(checkpoint, job, nowMs));
    }
    const stillSlicing = job?.status === "running" || (!job && isoMs(checkpoint.serverStartedAt) != null);
    if (stillSlicing) {
        const elapsed = sliceElapsedMs(checkpoint, job, nowMs);
        if (elapsed != null && elapsed >= SLICE_JOB_SLICE_CAP_MS) throw sliceTimeError(side);
    }
}

export async function runCadSliceAttempt(args: {
    request: VertexSliceRequest | null;
    checkpoint: SliceCheckpointV1 | null;
    stlStorageKey: string;
    meshFingerprint: string | null;
    credentialId: string;
    side: CadFootSide | null;
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    budgetMs: number;
    persistCheckpoint?: (checkpoint: SliceCheckpointV1) => Promise<void>;
}): Promise<
    { kind: "gcode"; gcode: string; jobId: string } | { kind: "pending"; checkpoint: SliceCheckpointV1 }
> {
    const budgetEnd = args.now().getTime() + Math.max(0, args.budgetMs);
    let checkpoint = args.checkpoint;
    if (!checkpoint) {
        if (!args.request) throw new Error("VertexSlice server error: slice request missing");
        const submitted = await submitVertexSliceJob(args.request);
        if (submitted.kind === "unsupported") {
            const gcode = await sliceWithVertexSlice(args.request);
            const stamp = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            return { kind: "gcode", gcode, jobId: `vs_${stamp}` };
        }
        checkpoint = {
            v: 1,
            jobId: submitted.jobId,
            acceptedAt: args.now().toISOString(),
            stlStorageKey: args.stlStorageKey,
            meshFingerprint: args.meshFingerprint,
            expectedRegionCount: args.request.expectedRegionCount ?? 0,
            credentialId: args.credentialId,
            serverStartedAt: null,
        };
        await args.persistCheckpoint?.(checkpoint);
    }
    if (!checkpoint) throw new Error("VertexSlice server error: slice request missing");

    for (;;) {
        const nowMs = args.now().getTime();
        const viewed = await getVertexSliceJob(checkpoint.jobId);
        if (viewed.kind === "missing") throw jobLostError(args.side);
        if (viewed.kind === "unavailable") {
            assertSliceCaps(checkpoint, null, nowMs, args.side);
        } else {
            const job = viewed.job;
            if (job.startedAt && job.startedAt !== checkpoint.serverStartedAt) {
                checkpoint = { ...checkpoint, serverStartedAt: job.startedAt };
                await args.persistCheckpoint?.(checkpoint);
            }
            assertSliceCaps(checkpoint, job, nowMs, args.side);
            if (job.status === "failed") throw serverJobError(args.side, job.error ?? "slice failed");
            if (job.status === "succeeded") {
                const result = await downloadVertexSliceJobResult(
                    checkpoint.jobId,
                    checkpoint.expectedRegionCount,
                );
                if (result.kind === "missing") throw jobLostError(args.side);
                if (result.kind === "gcode") {
                    return { kind: "gcode", gcode: result.gcode, jobId: `vs_${checkpoint.jobId}` };
                }
            }
        }
        if (args.now().getTime() >= budgetEnd) return { kind: "pending", checkpoint };
        if (args.now().getTime() + SLICE_JOB_POLL_INTERVAL_MS > budgetEnd)
            return { kind: "pending", checkpoint };
        const beforeSleep = args.now().getTime();
        await args.sleep(SLICE_JOB_POLL_INTERVAL_MS);
        if (args.now().getTime() <= beforeSleep) return { kind: "pending", checkpoint };
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
