// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { TRPCError } from "@trpc/server";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../../shared/print-recipe/print-recipe.js";
import {
    isVertexSlice3mfModel,
    VERTEXSLICE_3MF_CONTENT_TYPE,
    VERTEXSLICE_3MF_FILENAME,
    VERTEXSLICE_REGIONS_HEADER,
} from "../../../shared/vertexslice-regional-3mf.js";
import { prepareManufacturingMeshForSlice, sliceMeshStats, UnsliceableMeshError } from "./slice-mesh.js";
import { readUpstreamErrorText, upstreamErrorText } from "./upstream-error.js";

/** VertexSlice `/v1/slice` material ids. `apex_vylon` is AFO shell only (not an insole picker option). */
export const VERTEX_SLICE_MATERIAL_IDS = [
    "apex_core",
    "apex_light",
    "apex_forge",
    "apex_bounce",
    "apex_vylon",
] as const;

export type VertexSliceMaterialId = (typeof VERTEX_SLICE_MATERIAL_IDS)[number];

export const ENABLED_VERTEX_SLICE_MATERIALS = [
    "apex_core",
    "apex_light",
    "apex_bounce",
    "apex_forge",
    "apex_vylon",
] as const;

export type EnabledVertexSliceMaterial = (typeof ENABLED_VERTEX_SLICE_MATERIALS)[number];

export function materialUnavailableMessage(material: string, upstream?: string): string {
    const base = `Material ${material} not available on slicer`;
    const extra = upstream?.trim();
    if (!extra || extra === base) return base;
    return `${base}: ${extra}`;
}

export function getVertexSliceConfig(): { baseUrl: string; apiKey: string } {
    const baseUrl = process.env.VERTEXSLICE_SLICER_URL?.trim() ?? "";
    const apiKey = process.env.VERTEXSLICE_API_KEY?.trim() ?? "";
    if (!baseUrl) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "VERTEXSLICE_SLICER_URL is not set",
        });
    }
    if (!apiKey) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "VERTEXSLICE_API_KEY is not set",
        });
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/** Printer G-code uses VertexSlice. STL output stays on the Python manufacturing service. */
export function manufacturingBackendForOutput(outputType: "gcode" | "stl"): "vertexslice" | "python" {
    return outputType === "gcode" ? "vertexslice" : "python";
}

/**
 * Apex Bounce and Forge process deltas are VertexSlice material profiles, not fields on this form.
 * `apex_vylon` is the AFO shell material (Forge contract, belt/bed 60°C, wall loops 6).
 * It is not an insole picker option. Any other id, including legacy Shore-A names, is refused.
 * Nothing is substituted.
 */
export function assertEnabledVertexSliceMaterial(material: string | undefined): EnabledVertexSliceMaterial {
    const id = material?.trim() ?? "";
    if (
        id !== "apex_core" &&
        id !== "apex_light" &&
        id !== "apex_bounce" &&
        id !== "apex_forge" &&
        id !== "apex_vylon"
    ) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message:
                "Printer G-code requires Apex Core (apex_core), Apex Light (apex_light), Apex Bounce (apex_bounce), Apex Forge (apex_forge), or apex_vylon (AFO shell).",
        });
    }
    return id;
}

export function assertLockedVertexSliceProfile(profileId: string): string {
    if (profileId !== APEX_V2_INSOLE_LOCKED_PROFILE_ID) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Printer G-code requires locked profile ${APEX_V2_INSOLE_LOCKED_PROFILE_ID}`,
        });
    }
    return profileId;
}

/**
 * Canonical insole print materials for MCP `list_materials` and CAD-operator
 * generate_gcode. Keep this object identical to
 * packages/mcp/src/tools/print-materials.ts. ApexVylon is not an insole material.
 * "ApexLight Foam" is the VertexOrders label for Apex Light.
 */
export const CANONICAL_INSOLE_PRINT_MATERIALS = {
    locked_preset_id: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
    default_material: "apex_core",
    materials: [
        {
            id: "ApexLight",
            label: "Apex Light",
            vertex_slice_material: "apex_light",
            enabled: true,
            locked_preset_id: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            aliases: ["ApexLight", "Apex Light", "apex_light", "ApexLight Foam"],
        },
        {
            id: "ApexCore",
            label: "Apex Core",
            vertex_slice_material: "apex_core",
            enabled: true,
            locked_preset_id: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            aliases: ["ApexCore", "Apex Core", "apex_core", "ApexComfort", "Apex Comfort"],
        },
        {
            id: "ApexBounce",
            label: "Apex Bounce",
            vertex_slice_material: "apex_bounce",
            enabled: true,
            locked_preset_id: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            aliases: ["ApexBounce", "Apex Bounce", "apex_bounce"],
        },
        {
            id: "ApexForge",
            label: "Apex Forge",
            vertex_slice_material: "apex_forge",
            enabled: true,
            locked_preset_id: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            aliases: ["ApexForge", "Apex Forge", "apex_forge"],
        },
    ],
} as const;

export function canonicalInsolePrintMaterialCatalog(): typeof CANONICAL_INSOLE_PRINT_MATERIALS {
    return CANONICAL_INSOLE_PRINT_MATERIALS;
}

function compactMaterialKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

const SLICE_ID_BY_COMPACT_KEY = new Map<string, VertexSliceMaterialId>();
for (const material of CANONICAL_INSOLE_PRINT_MATERIALS.materials) {
    const id = material.vertex_slice_material;
    for (const key of [material.id, material.label, material.vertex_slice_material, ...material.aliases]) {
        const compact = compactMaterialKey(key);
        if (compact) SLICE_ID_BY_COMPACT_KEY.set(compact, id);
    }
}

/**
 * Map a caller material to an enabled VertexSlice id.
 * Omitted or blank uses `omitted` (CAD-operator passes CAD_OPERATOR_BELT_MATERIAL).
 * Unknown names throw. Nothing is substituted.
 */
export function resolveEnabledSliceMaterial(
    material: string | undefined,
    omitted: EnabledVertexSliceMaterial = "apex_core",
): EnabledVertexSliceMaterial {
    const raw = material?.trim() ?? "";
    if (!raw) return assertEnabledVertexSliceMaterial(omitted);
    const id = SLICE_ID_BY_COMPACT_KEY.get(compactMaterialKey(raw));
    if (!id) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Unknown print material "${raw}". Use apex_core, apex_light, apex_bounce, or apex_forge. Nothing was substituted.`,
        });
    }
    return assertEnabledVertexSliceMaterial(id);
}

function vertexSliceUrl(baseUrl: string, path: string): string {
    return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(apiKey: string): Record<string, string> {
    return { "X-API-Key": apiKey };
}

/**
 * Ids from `GET /v1/materials`.
 * Accepts a string array, `{ materials|filaments|items|data }`, or a map of id → definition.
 * Returns null when the payload shape is not a material list.
 */
export function materialIdsFromPayload(payload: unknown): string[] | null {
    const fromList = (value: unknown): string[] | null => {
        if (!Array.isArray(value)) return null;
        const ids: string[] = [];
        for (const item of value) {
            if (typeof item === "string" && item.trim()) {
                ids.push(item.trim());
                continue;
            }
            if (!item || typeof item !== "object") continue;
            const rec = item as Record<string, unknown>;
            const id = rec.id ?? rec.material ?? rec.material_id ?? rec.name ?? rec.code;
            if (typeof id === "string" && id.trim()) ids.push(id.trim());
        }
        return ids;
    };

    const direct = fromList(payload);
    if (direct) return direct;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const rec = payload as Record<string, unknown>;
    for (const key of ["materials", "filaments", "items", "data", "results"]) {
        if (!(key in rec)) continue;
        const nested = fromList(rec[key]);
        if (nested) return nested;
        const child = rec[key];
        if (child && typeof child === "object" && !Array.isArray(child)) {
            const mapIds = materialMapIds(child as Record<string, unknown>);
            if (mapIds) return mapIds;
        }
    }
    return materialMapIds(rec);
}

function materialMapIds(rec: Record<string, unknown>): string[] | null {
    const keys = Object.keys(rec);
    if (!keys.length) return null;
    if (keys.some((key) => key === "message" || key === "detail" || key === "error" || key === "status")) {
        return null;
    }
    const valuesAreDefinitions = keys.every((key) => {
        const value = rec[key];
        return value !== null && typeof value === "object";
    });
    return valuesAreDefinitions ? keys : null;
}

function materialIsListed(listed: readonly string[], material: string): boolean {
    const wanted = material.trim().toLowerCase();
    return listed.some((id) => id.trim().toLowerCase() === wanted);
}

function isMaterialRejection(errorText: string, material: string): boolean {
    const text = errorText.toLowerCase();
    const id = material.trim().toLowerCase();
    if (!id) return false;
    const mentionsMaterial = text.includes(id) || /\bmaterial\b|\bfilament\b/.test(text);
    if (!mentionsMaterial) return false;
    return /not available|not found|unknown|unsupported|unrecognized|invalid|not allowed|no such/.test(text);
}

/**
 * One foot plus the 20 mm toe leader. A stray vertex or a unit blow-up is larger.
 * 134,310 triangles (the 6.7 MB hung model) is inside this cap.
 * prepareManufacturingMeshForSlice still rewrites a watertight mesh over 132,000.
 */
const MAX_SLICE_EXTENT_MM = 450;
const MAX_SLICE_TRIANGLES = 750_000;
const DEGENERATE_CROSS2 = 1e-16;

export interface ManufacturingStlInspection {
    binary: boolean;
    triangles: number | null;
    extentMm: [number, number, number] | null;
    problem: string | null;
}

/** Binary STL only. Other bytes are left for the slicer (tests use tiny placeholders). */
export function inspectManufacturingStl(model: Uint8Array): ManufacturingStlInspection {
    const empty: ManufacturingStlInspection = {
        binary: false,
        triangles: null,
        extentMm: null,
        problem: null,
    };
    if (model.byteLength < 84) return empty;
    const view = new DataView(model.buffer, model.byteOffset, model.byteLength);
    const triangles = view.getUint32(80, true);
    if (model.byteLength !== 84 + triangles * 50) return empty;
    if (triangles === 0) {
        return { binary: true, triangles: 0, extentMm: null, problem: "Manufacturing STL has no triangles" };
    }
    if (triangles > MAX_SLICE_TRIANGLES) {
        return {
            binary: true,
            triangles,
            extentMm: null,
            problem: `Manufacturing STL has ${triangles} triangles, over the ${MAX_SLICE_TRIANGLES} slice limit`,
        };
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let degenerate = 0;
    for (let i = 0; i < triangles; i++) {
        const base = 84 + i * 50 + 12;
        const x0 = view.getFloat32(base, true);
        const y0 = view.getFloat32(base + 4, true);
        const z0 = view.getFloat32(base + 8, true);
        const x1 = view.getFloat32(base + 12, true);
        const y1 = view.getFloat32(base + 16, true);
        const z1 = view.getFloat32(base + 20, true);
        const x2 = view.getFloat32(base + 24, true);
        const y2 = view.getFloat32(base + 28, true);
        const z2 = view.getFloat32(base + 32, true);
        if (
            !Number.isFinite(x0) ||
            !Number.isFinite(y0) ||
            !Number.isFinite(z0) ||
            !Number.isFinite(x1) ||
            !Number.isFinite(y1) ||
            !Number.isFinite(z1) ||
            !Number.isFinite(x2) ||
            !Number.isFinite(y2) ||
            !Number.isFinite(z2)
        ) {
            return {
                binary: true,
                triangles,
                extentMm: null,
                problem: "Manufacturing STL has a non-finite coordinate",
            };
        }
        minX = Math.min(minX, x0, x1, x2);
        minY = Math.min(minY, y0, y1, y2);
        minZ = Math.min(minZ, z0, z1, z2);
        maxX = Math.max(maxX, x0, x1, x2);
        maxY = Math.max(maxY, y0, y1, y2);
        maxZ = Math.max(maxZ, z0, z1, z2);
        const ax = x1 - x0;
        const ay = y1 - y0;
        const az = z1 - z0;
        const bx = x2 - x0;
        const by = y2 - y0;
        const bz = z2 - z0;
        const cx = ay * bz - az * by;
        const cy = az * bx - ax * bz;
        const cz = ax * by - ay * bx;
        if (cx * cx + cy * cy + cz * cz < DEGENERATE_CROSS2) degenerate += 1;
    }
    const extentMm: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
    if (degenerate * 2 >= triangles) {
        return {
            binary: true,
            triangles,
            extentMm,
            problem: "Manufacturing STL triangles are degenerate",
        };
    }
    if (
        extentMm[0] > MAX_SLICE_EXTENT_MM ||
        extentMm[1] > MAX_SLICE_EXTENT_MM ||
        extentMm[2] > MAX_SLICE_EXTENT_MM
    ) {
        const box = extentMm.map((mm) => Math.round(mm)).join("×");
        return {
            binary: true,
            triangles,
            extentMm,
            problem: `Manufacturing STL bounding box is ${box} mm, over the ${MAX_SLICE_EXTENT_MM} mm slice limit`,
        };
    }
    return { binary: true, triangles, extentMm, problem: null };
}

function isAbortOrTimeoutError(err: unknown): boolean {
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
        return true;
    }
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        return true;
    }
    return false;
}

function isFetchDeadlineError(err: unknown): boolean {
    if (isAbortOrTimeoutError(err)) return true;
    if (err instanceof Error && err.cause !== undefined) {
        return isFetchDeadlineError(err.cause);
    }
    return false;
}

function vertexSliceTimedOutError(timeoutSec: number, side?: string): Error {
    const suffix = side?.trim() ? ` (${side.trim()})` : "";
    return new Error(`VertexSlice timed out after ${timeoutSec}s${suffix}`);
}

interface SliceDeadline {
    signal: AbortSignal;
    cancel: () => void;
}

/**
 * Ref'd timer plus an AbortController we hold for the whole call.
 * AbortSignal.timeout is not used: Node arms it with an unref'd timer and a WeakRef,
 * and that signal did not reject the in-flight FormData fetch before Vercel killed the isolate.
 */
function armSliceDeadline(timeoutMs: number): SliceDeadline {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    }, timeoutMs);
    timer.ref?.();
    return {
        signal: controller.signal,
        cancel: () => clearTimeout(timer),
    };
}

function listenAbort(signal: AbortSignal): { promise: Promise<never>; cancel: () => void } {
    if (signal.aborted) {
        return { promise: Promise.reject(signal.reason), cancel: () => undefined };
    }
    let rejectPending: (reason: unknown) => void = () => undefined;
    const promise = new Promise<never>((_, reject) => {
        rejectPending = reject;
    });
    const onAbort = () => rejectPending(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    return {
        promise,
        cancel: () => signal.removeEventListener("abort", onAbort),
    };
}

function throwIfDeadline(
    err: unknown,
    signal: AbortSignal | undefined,
    timedOut: { timeoutSec: number; side?: string } | undefined,
): never {
    if (timedOut && (signal?.aborted || isFetchDeadlineError(err))) {
        throw vertexSliceTimedOutError(timedOut.timeoutSec, timedOut.side);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message,
    });
}

async function settleWithinSignal<T>(
    pending: Promise<T>,
    signal: AbortSignal | undefined,
    timedOut: { timeoutSec: number; side?: string } | undefined,
    networkUrl?: string,
): Promise<T> {
    void pending.catch(() => undefined);
    if (!signal) return pending;
    const gated = listenAbort(signal);
    void gated.promise.catch(() => undefined);
    try {
        return await Promise.race([pending, gated.promise]);
    } catch (err: unknown) {
        if (timedOut && (signal.aborted || isFetchDeadlineError(err))) {
            throw vertexSliceTimedOutError(timedOut.timeoutSec, timedOut.side);
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: networkUrl ? `Could not reach VertexSlice (${networkUrl}): ${message}` : message,
        });
    } finally {
        gated.cancel();
    }
}

async function vertexSliceFetch(
    url: string,
    init: RequestInit,
    opts?: { timedOut?: { timeoutSec: number; side?: string } },
): Promise<Response> {
    const pending = fetch(url, init);
    try {
        return await settleWithinSignal(pending, init.signal ?? undefined, opts?.timedOut, url);
    } catch (err: unknown) {
        if (
            err instanceof TRPCError ||
            (err instanceof Error && err.message.startsWith("VertexSlice timed out after"))
        ) {
            throw err;
        }
        throwIfDeadline(err, init.signal ?? undefined, opts?.timedOut);
    }
}

export async function listVertexSliceMaterials(opts?: {
    signal?: AbortSignal;
    timedOut?: { timeoutSec: number; side?: string };
}): Promise<string[]> {
    const { baseUrl, apiKey } = getVertexSliceConfig();
    const endpoint = vertexSliceUrl(baseUrl, "/v1/materials");
    const response = await vertexSliceFetch(
        endpoint,
        {
            method: "GET",
            headers: authHeaders(apiKey),
            signal: opts?.signal,
        },
        opts?.timedOut ? { timedOut: opts.timedOut } : undefined,
    );
    if (!response.ok) {
        const detail = await readUpstreamErrorText(response);
        throw new TRPCError({
            code:
                response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR",
            message: `VertexSlice error (${response.status}): ${detail}`,
        });
    }
    const raw = await settleWithinSignal(response.text(), opts?.signal, opts?.timedOut);
    let payload: unknown = null;
    try {
        payload = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
        payload = null;
    }
    const ids = materialIdsFromPayload(payload);
    if (!ids) {
        const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 180);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `VertexSlice /v1/materials returned an unrecognized payload${snippet ? `: ${snippet}` : ""}`,
        });
    }
    return ids;
}

export interface VertexSliceRequest {
    profileId: string;
    material: VertexSliceMaterialId | string;
    model: Uint8Array;
    filename?: string;
    /** PrintRecipe hardness percent on the locked profile. Wall loops are never sent. */
    infillDensityPct?: number;
    /**
     * Ref'd deadline for the materials GET, POST /v1/slice, and the G-code body.
     * Evaluated by the caller immediately before this call so download time counts.
     */
    sliceTimeoutMs?: number;
    /** Included in timeout errors when sliceTimeoutMs is set. */
    side?: string;
    /**
     * Modifier regions in a 3MF model. The response must include
     * X-VertexSlice-Regions with at least this count. Omit for an STL.
     */
    expectedRegionCount?: number;
}

/**
 * Slice one STL on VertexSlice.
 * Sends `profile_id`, `model`, `material`, and the PrintRecipe infill percent.
 * Does not send wall loops or any other process override.
 * Fails closed when the material is absent from `/v1/materials` or the slice call rejects it.
 */
function regionsHeaderCount(response: Response): number | null {
    const raw = response.headers.get(VERTEXSLICE_REGIONS_HEADER);
    if (raw == null) return null;
    const text = raw.trim();
    if (!/^\d+$/.test(text)) return null;
    return Number(text);
}

/** Multipart fields shared by POST /v1/slice and POST /v1/slice/jobs. */
export function buildSliceForm(args: {
    profileId: string;
    material: string;
    infillDensityPct: number | undefined;
    bytes: Uint8Array;
    is3mf: boolean;
    filename: string | undefined;
}): FormData {
    const form = new FormData();
    form.append("profile_id", args.profileId);
    form.append("material", args.material);
    if (args.infillDensityPct !== undefined) {
        const pct = args.infillDensityPct;
        if (!Number.isInteger(pct) || pct < 5 || pct > 100) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: `PrintRecipe infill ${pct}% is outside the locked slicer range (5–100)`,
            });
        }
        form.append("infill_density", String(pct));
    }
    if (args.is3mf) {
        form.append(
            "model",
            new Blob([args.bytes], { type: VERTEXSLICE_3MF_CONTENT_TYPE }),
            VERTEXSLICE_3MF_FILENAME,
        );
    } else {
        form.append("model", new Blob([args.bytes], { type: "model/stl" }), args.filename ?? "model.stl");
    }
    return form;
}

function assertSliceRegions(response: Response, expectedRegions: number): void {
    if (expectedRegions <= 0) return;
    const applied = regionsHeaderCount(response);
    if (applied == null || applied < expectedRegions) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message:
                applied == null
                    ? `Regional hardness was not confirmed (missing ${VERTEXSLICE_REGIONS_HEADER}; sent ${expectedRegions} modifier regions). Refusing a single-density print.`
                    : `Regional hardness applied ${applied} of ${expectedRegions} modifier regions. Refusing a single-density print.`,
        });
    }
}

function throwSliceHttpError(
    status: number,
    rawDetail: string,
    statusText: string,
    material: string,
    expectedRegions: number,
): never {
    let detail = rawDetail.trim();
    if (detail) {
        try {
            detail = upstreamErrorText(JSON.parse(rawDetail) as unknown, statusText);
        } catch {
            detail = rawDetail.trim();
        }
    } else {
        detail = upstreamErrorText(null, statusText);
    }
    if (isMaterialRejection(detail, material)) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: materialUnavailableMessage(material, detail),
        });
    }
    if (status === 422 && expectedRegions > 0) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Regional hardness was rejected by VertexSlice (422): ${detail}`,
        });
    }
    throw new TRPCError({
        code: status === 401 || status === 403 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR",
        message: `VertexSlice error (${status}): ${detail}`,
    });
}

interface OpenedSliceForm {
    material: string;
    profileId: string;
    bytes: Uint8Array;
    is3mf: boolean;
    expectedRegions: number;
    triangles: number | null;
    extentMm: [number, number, number] | null;
    form: FormData;
    baseUrl: string;
    apiKey: string;
}

async function openSliceForm(
    request: VertexSliceRequest,
    fetchOpts?: { signal?: AbortSignal; timedOut?: { timeoutSec: number; side?: string } },
): Promise<OpenedSliceForm> {
    const material = assertEnabledVertexSliceMaterial(request.material);
    const profileId = assertLockedVertexSliceProfile(request.profileId.trim());
    let bytes: Uint8Array = new Uint8Array(request.model);
    const expectedRegions = request.expectedRegionCount ?? 0;
    const is3mf = isVertexSlice3mfModel(bytes, request.filename);
    if (expectedRegions > 0 && !is3mf) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Regional hardness expected ${expectedRegions} modifier regions but the model is not a 3MF. Refusing a single-density print.`,
        });
    }
    let triangles: number | null = null;
    let extentMm: [number, number, number] | null = null;
    if (!is3mf) {
        let mesh = inspectManufacturingStl(bytes);
        if (mesh.problem) {
            throw new TRPCError({ code: "BAD_REQUEST", message: mesh.problem });
        }
        try {
            const prepared = prepareManufacturingMeshForSlice(bytes);
            if (prepared !== bytes) {
                bytes = prepared;
                mesh = inspectManufacturingStl(bytes);
                if (mesh.problem) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: mesh.problem });
                }
            }
        } catch (err) {
            if (err instanceof UnsliceableMeshError) {
                throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
            }
            throw err;
        }
        triangles = mesh.triangles;
        extentMm = mesh.extentMm;
    }
    const listed = await listVertexSliceMaterials(fetchOpts);
    if (!materialIsListed(listed, material)) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: materialUnavailableMessage(material),
        });
    }
    const { baseUrl, apiKey } = getVertexSliceConfig();
    const form = buildSliceForm({
        profileId,
        material,
        infillDensityPct: request.infillDensityPct,
        bytes,
        is3mf,
        filename: request.filename,
    });
    return {
        material,
        profileId,
        bytes,
        is3mf,
        expectedRegions,
        triangles,
        extentMm,
        form,
        baseUrl,
        apiKey,
    };
}

export async function sliceWithVertexSlice(request: VertexSliceRequest): Promise<string> {
    const sliceTimeoutMs =
        request.sliceTimeoutMs !== undefined ? Math.max(1, request.sliceTimeoutMs) : undefined;
    const sliceTimeoutSec =
        sliceTimeoutMs !== undefined ? Math.max(1, Math.ceil(sliceTimeoutMs / 1000)) : undefined;
    const timedOut =
        sliceTimeoutSec !== undefined ? { timeoutSec: sliceTimeoutSec, side: request.side } : undefined;
    const deadline = sliceTimeoutMs !== undefined ? armSliceDeadline(sliceTimeoutMs) : null;

    try {
        const opened = await openSliceForm(
            request,
            deadline ? { signal: deadline.signal, timedOut } : undefined,
        );
        const {
            material,
            profileId,
            bytes,
            is3mf,
            expectedRegions,
            triangles,
            extentMm,
            form,
            baseUrl,
            apiKey,
        } = opened;
        const endpoint = vertexSliceUrl(baseUrl, "/v1/slice");

        console.log("[vertexslice] -> POST /v1/slice", {
            endpoint,
            profileId,
            material,
            infillDensityPct: request.infillDensityPct ?? null,
            modelBytes: bytes.byteLength,
            model: is3mf ? VERTEXSLICE_3MF_FILENAME : (request.filename ?? "model.stl"),
            expectedRegions: expectedRegions || null,
            triangles,
            extentMm,
            authenticated: true,
        });

        let response: Response;
        try {
            response = await vertexSliceFetch(
                endpoint,
                {
                    method: "POST",
                    headers: authHeaders(apiKey),
                    body: form,
                    signal: deadline?.signal,
                },
                timedOut ? { timedOut } : undefined,
            );
        } catch (err) {
            if (err instanceof Error && err.message.startsWith("VertexSlice timed out")) {
                console.error("[vertexslice] mesh at timeout", sliceMeshStats(bytes));
            }
            throw err;
        }

        if (!response.ok) {
            const rawDetail = await settleWithinSignal(response.text(), deadline?.signal, timedOut);
            console.error("[vertexslice] slice failed", {
                endpoint,
                status: response.status,
                material,
            });
            throwSliceHttpError(response.status, rawDetail, response.statusText, material, expectedRegions);
        }

        assertSliceRegions(response, expectedRegions);

        const gcode = await settleWithinSignal(response.text(), deadline?.signal, timedOut);
        if (!gcode.trim()) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "VertexSlice returned empty G-code",
            });
        }
        console.log("[vertexslice] <- POST /v1/slice OK", { profileId, material, bytes: gcode.length });
        return gcode;
    } finally {
        deadline?.cancel();
    }
}

/** One status or result round trip. Keeps a Vercel invocation off a multi-minute slice. */
const SLICE_JOB_STATUS_TIMEOUT_MS = 15_000;
const SLICE_JOB_RESULT_TIMEOUT_MS = 30_000;
/**
 * Budget for reading POST /v1/slice/jobs only.
 * Armed after openSliceForm returns. Mesh prep and the materials GET must not
 * share it: a pair generate was aborting the POST once prep had used the old
 * 20s budget, so the client never read a 202 the server had already queued.
 * 60s is long enough to read that 202. FormData abort on Vercel has not always
 * rejected promptly (see armSliceDeadline).
 */
const SLICE_JOB_SUBMIT_TIMEOUT_MS = 60_000;
const SLICE_JOB_SUBMIT_ATTEMPTS = 3;
/** First retry waits this long. Each later retry doubles it. */
const SLICE_JOB_SUBMIT_BACKOFF_BASE_MS = 250;

function sliceJobSubmitBackoffMs(failedAttempts: number): number {
    return SLICE_JOB_SUBMIT_BACKOFF_BASE_MS * 2 ** (failedAttempts - 1);
}

function delaySliceSubmitRetry(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.ref?.();
    });
}

export type VertexSliceJobStatusName = "queued" | "running" | "succeeded" | "failed";

export interface VertexSliceJobSnapshot {
    jobId: string;
    status: VertexSliceJobStatusName;
    position: number | null;
    queuedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    elapsedS: number | null;
    error: string | null;
}

export type SubmitVertexSliceJobResult =
    | { kind: "accepted"; jobId: string; position: number }
    | { kind: "unsupported" };

export type VertexSliceJobFetch =
    | { kind: "job"; job: VertexSliceJobSnapshot }
    | { kind: "missing" }
    | { kind: "unavailable" };

export type VertexSliceJobResult =
    | { kind: "gcode"; gcode: string }
    | { kind: "not-ready" }
    | { kind: "missing" }
    | { kind: "unavailable" };

function sliceJobPath(jobId: string): string {
    const id = jobId.trim();
    if (!id || id.length > 200 || /[\s/?#\\]/.test(id) || id.includes("..")) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "VertexSlice server error: invalid job id",
        });
    }
    return `/v1/slice/jobs/${encodeURIComponent(id)}`;
}

function nullableString(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text || null;
}

function nullableNumber(value: unknown): number | null {
    if (value == null) return null;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJobSnapshot(payload: unknown): VertexSliceJobSnapshot | null {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    const jobId = typeof record.job_id === "string" ? record.job_id.trim() : "";
    const status = record.status;
    if (!jobId) return null;
    if (status !== "queued" && status !== "running" && status !== "succeeded" && status !== "failed")
        return null;
    const position = record.position;
    return {
        jobId,
        status,
        position: typeof position === "number" && Number.isFinite(position) ? position : null,
        queuedAt: nullableString(record.queued_at),
        startedAt: nullableString(record.started_at),
        finishedAt: nullableString(record.finished_at),
        elapsedS: nullableNumber(record.elapsed_s),
        error: nullableString(record.error),
    };
}

function isTransientSliceFetch(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err.message.startsWith("VertexSlice error (")) return false;
    if (err.message.startsWith("VertexSlice timed out after")) return true;
    if (err.message.startsWith("Could not reach VertexSlice")) return true;
    return err.name === "AbortError" || err.name === "TimeoutError" || /aborted|timeout/i.test(err.message);
}

async function fetchSliceJob(
    url: string,
    timeoutMs: number,
    init: RequestInit,
): Promise<Response | "unavailable"> {
    const deadline = armSliceDeadline(timeoutMs);
    try {
        return await vertexSliceFetch(url, { ...init, signal: deadline.signal });
    } catch (err) {
        if (isTransientSliceFetch(err)) return "unavailable";
        throw err;
    } finally {
        deadline.cancel();
    }
}

/**
 * POST /v1/slice/jobs. Same auth and multipart fields as POST /v1/slice.
 * The submit deadline starts here, after the form is built.
 * HTTP 404 means this server does not have the job route yet.
 * Any other 4xx is thrown immediately, the same way /v1/slice rejects it.
 */
async function postVertexSliceJob(
    opened: OpenedSliceForm,
    timedOut: { timeoutSec: number; side?: string },
): Promise<SubmitVertexSliceJobResult> {
    const endpoint = vertexSliceUrl(opened.baseUrl, "/v1/slice/jobs");
    console.log("[vertexslice] -> POST /v1/slice/jobs", {
        profileId: opened.profileId,
        material: opened.material,
        modelBytes: opened.bytes.byteLength,
        authenticated: true,
    });
    const deadline = armSliceDeadline(SLICE_JOB_SUBMIT_TIMEOUT_MS);
    try {
        const response = await vertexSliceFetch(
            endpoint,
            {
                method: "POST",
                headers: authHeaders(opened.apiKey),
                body: opened.form,
                signal: deadline.signal,
            },
            { timedOut },
        );
        if (response.status === 404) {
            await response.text().catch(() => undefined);
            return { kind: "unsupported" };
        }
        if (!response.ok) {
            let rawDetail = "";
            try {
                rawDetail = await settleWithinSignal(response.text(), deadline.signal, timedOut, endpoint);
            } catch (err) {
                if (!isTransientSliceFetch(err)) throw err;
            }
            throwSliceHttpError(
                response.status,
                rawDetail,
                response.statusText,
                opened.material,
                opened.expectedRegions,
            );
        }
        const raw = await settleWithinSignal(response.text(), deadline.signal, timedOut, endpoint);
        let payload: unknown = null;
        try {
            payload = raw ? (JSON.parse(raw) as unknown) : null;
        } catch {
            payload = null;
        }
        const job = parseJobSnapshot(payload);
        const position =
            payload &&
            typeof payload === "object" &&
            typeof (payload as { position?: unknown }).position === "number"
                ? (payload as { position: number }).position
                : null;
        if (!job || job.status !== "queued" || position == null) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "VertexSlice server error: invalid job response",
            });
        }
        console.log("[vertexslice] <- POST /v1/slice/jobs", { jobId: job.jobId, position });
        return { kind: "accepted", jobId: job.jobId, position };
    } finally {
        deadline.cancel();
    }
}

/**
 * POST /v1/slice/jobs. Same auth and multipart fields as POST /v1/slice.
 * HTTP 404 means this server does not have the job route yet.
 * Any other 4xx is thrown immediately, the same way /v1/slice rejects it.
 * Transient reachability, abort, and timeout failures retry with bounded backoff.
 * VertexSlice mints a new job id on every accepted POST, so a retry after a lost
 * 202 can leave the unread job queued.
 */
export async function submitVertexSliceJob(request: VertexSliceRequest): Promise<SubmitVertexSliceJobResult> {
    const timedOut = {
        timeoutSec: Math.max(1, Math.ceil(SLICE_JOB_SUBMIT_TIMEOUT_MS / 1000)),
        side: request.side,
    };
    for (let attempt = 1; attempt <= SLICE_JOB_SUBMIT_ATTEMPTS; attempt++) {
        try {
            const opened = await openSliceForm(request);
            return await postVertexSliceJob(opened, timedOut);
        } catch (err) {
            if (!isTransientSliceFetch(err)) throw err;
            if (attempt === SLICE_JOB_SUBMIT_ATTEMPTS) break;
            const reason = err instanceof Error ? err.message.slice(0, 200) : "transient";
            console.log("[vertexslice] submit retry", { attempt, reason });
            await delaySliceSubmitRetry(sliceJobSubmitBackoffMs(attempt));
        }
    }
    throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "VertexSlice server error: submit unavailable",
    });
}

export async function getVertexSliceJob(jobId: string): Promise<VertexSliceJobFetch> {
    const { baseUrl, apiKey } = getVertexSliceConfig();
    const endpoint = vertexSliceUrl(baseUrl, sliceJobPath(jobId));
    const response = await fetchSliceJob(endpoint, SLICE_JOB_STATUS_TIMEOUT_MS, {
        method: "GET",
        headers: authHeaders(apiKey),
    });
    if (response === "unavailable") return { kind: "unavailable" };
    if (response.status === 404) {
        await response.text().catch(() => undefined);
        return { kind: "missing" };
    }
    if (!response.ok) {
        const rawDetail = await response.text();
        throwSliceHttpError(response.status, rawDetail, response.statusText, "", 0);
    }
    const raw = await response.text();
    let payload: unknown = null;
    try {
        payload = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
        payload = null;
    }
    const job = parseJobSnapshot(payload);
    if (!job) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "VertexSlice server error: invalid job status",
        });
    }
    return { kind: "job", job };
}

/** Result body is the same text POST /v1/slice returns. It is not rewritten. */
export async function downloadVertexSliceJobResult(
    jobId: string,
    expectedRegionCount = 0,
): Promise<VertexSliceJobResult> {
    const { baseUrl, apiKey } = getVertexSliceConfig();
    const endpoint = vertexSliceUrl(baseUrl, `${sliceJobPath(jobId)}/result`);
    const response = await fetchSliceJob(endpoint, SLICE_JOB_RESULT_TIMEOUT_MS, {
        method: "GET",
        headers: authHeaders(apiKey),
    });
    if (response === "unavailable") return { kind: "unavailable" };
    if (response.status === 404) {
        await response.text().catch(() => undefined);
        return { kind: "missing" };
    }
    if (response.status === 409) {
        await response.text().catch(() => undefined);
        return { kind: "not-ready" };
    }
    if (!response.ok) {
        const rawDetail = await response.text();
        throwSliceHttpError(response.status, rawDetail, response.statusText, "", expectedRegionCount);
    }
    assertSliceRegions(response, expectedRegionCount);
    const gcode = await response.text();
    if (!gcode.trim()) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "VertexSlice returned empty G-code",
        });
    }
    return { kind: "gcode", gcode };
}
