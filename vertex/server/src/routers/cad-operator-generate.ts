// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// CAD-operator generateSolid: persist a production, return its id, slice later.

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import {
    buildExportFilename,
    canonicalExportMaterialName,
    exportSideSuffix,
} from "../../../shared/export-filename.js";
import { migratePrintRecipe, printRecipeV1Schema } from "../../../shared/print-recipe/print-recipe.js";
import {
    selectVertexSliceUpload,
    vertexSliceRegional3mfEnabled,
} from "../../../shared/vertexslice-regional-3mf.js";
import type { CadOperatorPrincipal } from "../auth/cad-operator.js";
import {
    assertCadOperatorDeliverableKey,
    buildCadOperatorGcodeKey,
    CENTRAL_FAB_STL_PRESET_ID,
    CNC_GCODE_PRESET_ID,
} from "../auth/cad-operator.js";
import { getSupabaseAdmin } from "../context.js";
import {
    beginCadOperatorProduction,
    type CadFootSide,
    type CadProductionStatus,
    CENTRAL_FAB_STL_COST,
    CNC_GCODE_COST,
    cadOperatorManufacturingIdentity,
    cadVertexSliceSliceTimeoutMs,
    executeCadOperatorProduction,
    expireStaleProduction,
    HYBRID_GCODE_COST,
    infillPctForCadSlice,
    type PublicProduction,
    scheduleCadProduction,
    toPublicProduction,
} from "../lib/cad-operator-production.js";
import { chargeExistingProduction, PrismaCadProductionStore } from "../lib/cad-operator-production-prisma.js";
import { openClientFiles, rethrowClientFile } from "../lib/client-file-access.js";
import { buildHeadlessMillCncGcode, prepareHeadlessMillDesign } from "../lib/cnc-mill-runner.js";
import { downloadManufacturingStl } from "../lib/manufacturing-stl-download.js";
import {
    archiveManufacturingSourceStl,
    deleteManufacturingTempBestEffort,
} from "../lib/manufacturing-stl-lifecycle.js";
import { deleteAsset, MANUFACTURING_BUCKET, signedDownloadUrl, uploadAsset } from "../lib/storage.js";
import { assertActiveLicense, getUserTokenBalance, requireSupabaseAdmin } from "../lib/supabase-db.js";
import { sliceWithVertexSlice } from "../lib/vertexslice-client.js";
import {
    loadDogfoodDesign,
    materializeCadOperatorStl,
    prepareCadOperatorGenerate,
} from "./manufacturing-cad.js";
import { assertDesignExportAccess } from "./manufacturing-session.js";

type SessionExportUser = { id: string; email: string; role: string };

function cadOperatorUserExportFilename(
    input: CadGenerateRequestInput,
    plan: Awaited<ReturnType<typeof prepareCadOperatorGenerate>>,
): string {
    if (input.fileName?.trim()) return input.fileName.trim();
    return buildExportFilename({
        firstName: plan.clientFirstName,
        lastName: plan.clientLastName,
        material: canonicalExportMaterialName(plan.material),
        side: exportSideSuffix(input.side),
        ext: "gcode",
    });
}

export interface CadGenerateRequestInput {
    designId: string;
    side: CadFootSide;
    presetId?: string;
    stlStorageKey: string;
    outputType: "gcode" | "stl";
    beltAngleDeg: number;
    layerHeightMm?: number;
    fileName?: string;
    useSavedDesignMesh?: boolean;
    patientName?: string;
    hardness?: string;
    material?: string;
    forceNewSlice?: boolean;
}

function requireStorage() {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
    }
    return supabase;
}

function mapChargeFailure(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("INSUFFICIENT_TOKENS")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
    }
    if (message.includes("NO_VALID_LICENSE")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No valid license" });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Manufacturing charge failed" });
}

export async function runCadOperatorGenerateRequest(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal;
    ip: string | null;
    input: CadGenerateRequestInput;
    schedule?: (work: Promise<void>) => void;
    now?: () => Date;
}): Promise<{
    ok: true;
    outputType: "gcode";
    productionId: string;
    status: CadProductionStatus;
    side: CadFootSide;
}> {
    const input = args.input;
    const plan = await prepareCadOperatorGenerate({
        prisma: args.prisma,
        principal: args.principal,
        designId: input.designId,
        side: input.side,
        outputType: input.outputType,
        useSavedDesignMesh: input.useSavedDesignMesh === true,
        stlStorageKey: input.stlStorageKey,
        patientName: input.patientName,
        hardness: input.hardness,
        presetId: input.presetId,
        material: input.material,
    });
    const userExportFileName = cadOperatorUserExportFilename(input, plan);
    const identity = cadOperatorManufacturingIdentity({
        designId: input.designId,
        side: input.side,
        presetId: plan.presetId,
        useSavedDesignMesh: plan.useSavedDesignMesh,
        material: plan.material,
        beltAngleDeg: plan.beltAngleDeg,
        layerHeightMm: input.layerHeightMm ?? null,
        printRecipe: plan.printRecipe,
        settingsJson: plan.settingsJson,
        stlStorageKey: plan.stlStorageKey,
        regional3mf: vertexSliceRegional3mfEnabled(),
    });
    const store = new PrismaCadProductionStore(args.prisma);
    const now = args.now ?? (() => new Date());
    const started = await beginCadOperatorProduction({
        store,
        now: now(),
        schedule: args.schedule ?? scheduleCadProduction,
        forceNewSlice: input.forceNewSlice === true && input.useSavedDesignMesh === true,
        insert: {
            designId: input.designId,
            side: input.side,
            presetId: plan.presetId,
            idempotencyKey: identity.idempotencyKey,
            settingsFingerprint: identity.fingerprint,
            beltAngleDeg: plan.beltAngleDeg,
            layerHeightMm: input.layerHeightMm ?? null,
            material: plan.material,
        },
        preflight: async () => {
            const admin = requireSupabaseAdmin();
            await assertActiveLicense(admin, plan.ownerId);
            const balance = await getUserTokenBalance(admin, plan.ownerId);
            if (balance < HYBRID_GCODE_COST) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
            }
        },
        execute: (row) => {
            let regional3mf: { bytes: Uint8Array; regionCount: number } | null = null;
            return executeCadOperatorProduction({
                row,
                store,
                now,
                materialize: async () => {
                    const materialized = await materializeCadOperatorStl({
                        plan,
                        credentialId: args.principal.credentialId,
                        side: input.side,
                        uploadStl: async (key, bytes) => {
                            await uploadAsset(
                                requireStorage(),
                                key,
                                bytes,
                                "model/stl",
                                MANUFACTURING_BUCKET,
                            );
                        },
                    });
                    regional3mf = materialized.regional3mf;
                    return {
                        stlStorageKey: materialized.stlStorageKey,
                        meshFingerprint: materialized.meshFingerprint,
                    };
                },
                slice: async (stlStorageKey, sliceCtx) => {
                    const supabase = requireStorage();
                    const stlUrl = await signedDownloadUrl(
                        supabase,
                        stlStorageKey,
                        3600,
                        MANUFACTURING_BUCKET,
                    );
                    const stlBytes = await downloadManufacturingStl(stlUrl);
                    const infillDensityPct = infillPctForCadSlice(plan.presetId, plan.printRecipe);
                    const sliceTimeoutMs = sliceCtx?.invocationStartedAt
                        ? cadVertexSliceSliceTimeoutMs(sliceCtx.invocationStartedAt, now())
                        : sliceCtx?.sliceTimeoutMs;
                    const upload = selectVertexSliceUpload({
                        stl: stlBytes,
                        stlFilename: `${input.side}.stl`,
                        regional3mf,
                        regional3mfEnabled: vertexSliceRegional3mfEnabled(),
                    });
                    const gcode = await sliceWithVertexSlice({
                        profileId: plan.presetId,
                        material: plan.material,
                        model: upload.bytes,
                        filename: upload.filename,
                        infillDensityPct,
                        expectedRegionCount: upload.expectedRegionCount,
                        sliceTimeoutMs,
                        side: input.side,
                    });
                    const jobStamp = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    return { gcode, jobId: `vs_${jobStamp}` };
                },
                uploadGcode: async (gcode) => {
                    const safeName = userExportFileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
                    const storageKey = buildCadOperatorGcodeKey(
                        args.principal.credentialId,
                        input.designId,
                        `${input.side}-${Date.now()}-${safeName}`,
                    );
                    await uploadAsset(
                        requireStorage(),
                        storageKey,
                        Buffer.from(gcode, "utf-8"),
                        "text/plain",
                        MANUFACTURING_BUCKET,
                    );
                    return { storageKey };
                },
                charge: async ({ storageKey, jobId, meshFingerprint }) => {
                    try {
                        return await chargeExistingProduction(args.prisma, {
                            userId: plan.ownerId,
                            cost: HYBRID_GCODE_COST,
                            productionId: row.id,
                            designId: input.designId,
                            exportFormat: "gcode",
                            side: input.side,
                            fileName: userExportFileName.replace(/[^a-zA-Z0-9_.-]/g, "_"),
                            presetId: plan.presetId,
                            beltAngleDeg: plan.beltAngleDeg,
                            layerHeightMm: input.layerHeightMm ?? null,
                            isGcode: true,
                            storageKey,
                            jobId,
                            ip: args.ip,
                            metadata: {
                                kind: "manufacturing_hybrid",
                                outputType: "gcode",
                                presetId: plan.presetId,
                                beltAngleDeg: plan.beltAngleDeg,
                                material: plan.material,
                                manufacturingFingerprint: meshFingerprint,
                                settingsFingerprint: identity.fingerprint,
                                cadOperatorCredentialId: args.principal.credentialId,
                                slicer: "vertexslice",
                                side: input.side,
                                layerHeightMm: input.layerHeightMm ?? null,
                                infillDensity: null,
                                source: "cad_operator_async",
                            },
                        });
                    } catch (error) {
                        mapChargeFailure(error);
                    }
                },
                archiveTemp: async ({ stlStorageKey, exportId }) => {
                    const supabase = getSupabaseAdmin();
                    if (!supabase) return;
                    await archiveManufacturingSourceStl(supabase, {
                        userId: plan.ownerId,
                        exportId,
                        tempStlKey: stlStorageKey,
                    });
                },
                deleteTemp: async (stlStorageKey) => {
                    deleteManufacturingTempBestEffort(getSupabaseAdmin(), stlStorageKey);
                },
            });
        },
    });
    return {
        ok: true,
        outputType: "gcode",
        productionId: started.productionId,
        status: started.status,
        side: started.side ?? input.side,
    };
}

function centralFabRecipe(settingsJson: unknown) {
    const settings = readStoredDesignSettings(settingsJson);
    const parsed = printRecipeV1Schema.safeParse(settings?.printRecipe);
    return parsed.success ? parsed.data : migratePrintRecipe(undefined);
}

/**
 * Enqueue the milling solid for one foot. Does not slice and does not write an order status.
 * Belt generateSolid is a different function.
 */
export async function runCadOperatorCentralFabStlRequest(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal;
    ip: string | null;
    input: { designId: string; side: CadFootSide };
    schedule?: (work: Promise<void>) => void;
    now?: () => Date;
}): Promise<{
    ok: true;
    outputType: "stl";
    productionId: string;
    status: CadProductionStatus;
    side: CadFootSide;
}> {
    const { row, design } = await loadDogfoodDesign(args.prisma, args.principal, args.input.designId);
    if (design.kind === "afo") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "AFO designs are not a central-fab insole STL" });
    }
    if (design.method !== "milling_3axis" && design.method !== "printing_solid") {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Central-fab STL uses the milling solid. This design method is not milling or solid.",
        });
    }
    const printRecipe = centralFabRecipe(design.settingsJson);
    const identity = cadOperatorManufacturingIdentity({
        designId: args.input.designId,
        side: args.input.side,
        presetId: CENTRAL_FAB_STL_PRESET_ID,
        useSavedDesignMesh: true,
        material: "central-fab",
        beltAngleDeg: 0,
        layerHeightMm: null,
        printRecipe,
        settingsJson: design.settingsJson,
        stlStorageKey: null,
        deliverable: "central_fab_stl",
    });
    const store = new PrismaCadProductionStore(args.prisma);
    const now = args.now ?? (() => new Date());
    const plan = {
        stlStorageKey: null,
        presetId: CENTRAL_FAB_STL_PRESET_ID,
        printRecipe,
        material: "central-fab",
        beltAngleDeg: 0,
        ownerId: design.ownerId,
        useSavedDesignMesh: true,
        settingsJson: design.settingsJson,
        clientFirstName: row?.client.firstName ?? "",
        clientLastName: row?.client.lastName ?? "",
    };
    const started = await beginCadOperatorProduction({
        store,
        now: now(),
        schedule: args.schedule ?? scheduleCadProduction,
        insert: {
            designId: args.input.designId,
            side: args.input.side,
            presetId: CENTRAL_FAB_STL_PRESET_ID,
            idempotencyKey: identity.idempotencyKey,
            settingsFingerprint: identity.fingerprint,
            beltAngleDeg: 0,
            layerHeightMm: null,
            material: "central-fab",
        },
        preflight: async () => {
            const admin = requireSupabaseAdmin();
            await assertActiveLicense(admin, design.ownerId);
            const balance = await getUserTokenBalance(admin, design.ownerId);
            if (balance < CENTRAL_FAB_STL_COST) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
            }
        },
        execute: (row) =>
            executeCadOperatorProduction({
                row,
                store,
                now,
                deliverMaterializedStl: true,
                materialize: () =>
                    materializeCadOperatorStl({
                        plan,
                        credentialId: args.principal.credentialId,
                        side: args.input.side,
                        centralFabSolid: { designId: args.input.designId },
                        uploadStl: async (key, bytes) => {
                            await uploadAsset(
                                requireStorage(),
                                key,
                                bytes,
                                "model/stl",
                                MANUFACTURING_BUCKET,
                            );
                        },
                    }),
                slice: async () => {
                    throw new Error("Central-fab STL is not sliced");
                },
                uploadGcode: async () => {
                    throw new Error("Central-fab STL is not sliced");
                },
                charge: async ({ storageKey, jobId, meshFingerprint }) => {
                    try {
                        return await chargeExistingProduction(args.prisma, {
                            userId: design.ownerId,
                            cost: CENTRAL_FAB_STL_COST,
                            productionId: row.id,
                            designId: args.input.designId,
                            exportFormat: "stl",
                            side: args.input.side,
                            fileName: `${args.input.side}.stl`,
                            presetId: CENTRAL_FAB_STL_PRESET_ID,
                            beltAngleDeg: 0,
                            layerHeightMm: null,
                            isGcode: false,
                            storageKey,
                            jobId,
                            ip: args.ip,
                            metadata: {
                                kind: "central_fab_stl",
                                outputType: "stl",
                                presetId: CENTRAL_FAB_STL_PRESET_ID,
                                manufacturingFingerprint: meshFingerprint,
                                settingsFingerprint: identity.fingerprint,
                                cadOperatorCredentialId: args.principal.credentialId,
                                side: args.input.side,
                                source: "cad_operator_async",
                            },
                        });
                    } catch (error) {
                        mapChargeFailure(error);
                    }
                },
                deleteTemp: async (stlStorageKey) => {
                    const supabase = getSupabaseAdmin();
                    if (!supabase) return;
                    if (stlStorageKey.startsWith("stl/cad-operator/")) {
                        await deleteAsset(supabase, stlStorageKey, MANUFACTURING_BUCKET).catch(
                            () => undefined,
                        );
                        return;
                    }
                    deleteManufacturingTempBestEffort(supabase, stlStorageKey);
                },
            }),
    });
    return {
        ok: true,
        outputType: "stl",
        productionId: started.productionId,
        status: started.status,
        side: started.side ?? args.input.side,
    };
}

const CNC_FILE_EXTENSION = ".gcode";

function cncIdempotencyKey(designId: string, sides: CadFootSide[], fingerprint: string): string {
    const sideKey = sides.length === 1 ? sides[0] : "pair";
    return `cadop:v1:${designId}:${sideKey}:${CNC_GCODE_PRESET_ID}:${fingerprint}`;
}

/**
 * One CNC file for the feet on a milled order. Print orders are refused.
 * The bytes are the browser Mill export (default Idaho profile, `.gcode`).
 */
export async function runCadOperatorCncGcodeRequest(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal;
    ip: string | null;
    input: { designId: string };
    schedule?: (work: Promise<void>) => void;
    now?: () => Date;
}): Promise<{
    ok: true;
    outputType: "gcode";
    productionId: string;
    status: CadProductionStatus;
    side: CadFootSide | null;
    sides: CadFootSide[];
    fileExtension: string;
}> {
    const { row, design } = await loadDogfoodDesign(args.prisma, args.principal, args.input.designId);
    if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Design not found" });
    }
    if (!readStoredDesignSettings(design.settingsJson)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Design has no saved parameter snapshot" });
    }
    const updatedAt =
        design.updatedAt instanceof Date ? design.updatedAt.toISOString() : String(design.updatedAt);
    let prepared: Awaited<ReturnType<typeof prepareHeadlessMillDesign>>;
    try {
        prepared = await prepareHeadlessMillDesign({
            id: design.id,
            pattern: design.pattern,
            method: design.method,
            thicknessMm: design.thicknessMm,
            linked: design.linked,
            unit: design.unit,
            createdAt: updatedAt,
            updatedAt,
            settingsJson: design.settingsJson,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const refused =
            message === "Print orders are not CNC G-code" || message === "No insole geometry to mill";
        throw new TRPCError({ code: refused ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR", message });
    }
    const sides = prepared.sides;
    if (sides.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No insole geometry to mill" });
    }
    const anchor = sides[0] ?? "left";
    const printRecipe = centralFabRecipe(design.settingsJson);
    const identity = cadOperatorManufacturingIdentity({
        designId: args.input.designId,
        side: anchor,
        presetId: CNC_GCODE_PRESET_ID,
        useSavedDesignMesh: true,
        material: "cnc",
        beltAngleDeg: 0,
        layerHeightMm: null,
        printRecipe,
        settingsJson: design.settingsJson,
        stlStorageKey: null,
        deliverable: "cnc_gcode",
        millSides: sides,
    });
    const storedSide: CadFootSide | null = sides.length === 1 ? (sides[0] ?? null) : null;
    const fileName = buildExportFilename({
        firstName: row.client.firstName ?? "",
        lastName: row.client.lastName ?? "",
        material: canonicalExportMaterialName("ApexCore"),
        side: exportSideSuffix(sides),
        ext: CNC_FILE_EXTENSION,
    });
    const store = new PrismaCadProductionStore(args.prisma);
    const now = args.now ?? (() => new Date());
    const started = await beginCadOperatorProduction({
        store,
        now: now(),
        schedule: args.schedule ?? scheduleCadProduction,
        insert: {
            designId: args.input.designId,
            side: storedSide,
            presetId: CNC_GCODE_PRESET_ID,
            idempotencyKey: cncIdempotencyKey(args.input.designId, sides, identity.fingerprint),
            settingsFingerprint: identity.fingerprint,
            beltAngleDeg: 0,
            layerHeightMm: null,
            material: "cnc",
        },
        preflight: async () => {
            const admin = requireSupabaseAdmin();
            await assertActiveLicense(admin, design.ownerId);
            const balance = await getUserTokenBalance(admin, design.ownerId);
            if (balance < CNC_GCODE_COST) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
            }
        },
        execute: (production) =>
            executeCadOperatorProduction({
                row: production,
                store,
                now,
                materialize: async () => ({ stlStorageKey: "memory", meshFingerprint: null }),
                slice: async () => {
                    const milled = await buildHeadlessMillCncGcode(prepared.design);
                    if (milled.fileExtension !== CNC_FILE_EXTENSION) {
                        throw new Error("CNC profile extension is not .gcode");
                    }
                    return { gcode: milled.gcode, jobId: `cnc_${production.id}` };
                },
                uploadGcode: async (gcode) => {
                    const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
                    const storageKey = buildCadOperatorGcodeKey(
                        args.principal.credentialId,
                        args.input.designId,
                        `pair-${Date.now()}-${safeName}`,
                    );
                    await uploadAsset(
                        requireStorage(),
                        storageKey,
                        Buffer.from(gcode, "utf8"),
                        "text/plain",
                        MANUFACTURING_BUCKET,
                    );
                    return { storageKey };
                },
                charge: async ({ storageKey, jobId, meshFingerprint }) => {
                    try {
                        return await chargeExistingProduction(args.prisma, {
                            userId: design.ownerId,
                            cost: CNC_GCODE_COST,
                            productionId: production.id,
                            designId: args.input.designId,
                            exportFormat: "gcode",
                            side: storedSide,
                            fileName: fileName.replace(/[^a-zA-Z0-9_.-]/g, "_"),
                            presetId: CNC_GCODE_PRESET_ID,
                            beltAngleDeg: 0,
                            layerHeightMm: null,
                            isGcode: true,
                            storageKey,
                            jobId,
                            ip: args.ip,
                            metadata: {
                                kind: "cnc_gcode",
                                outputType: "gcode",
                                presetId: CNC_GCODE_PRESET_ID,
                                fileExtension: CNC_FILE_EXTENSION,
                                sides,
                                settingsFingerprint: identity.fingerprint,
                                cadOperatorCredentialId: args.principal.credentialId,
                                side: storedSide,
                                source: "cad_operator_async",
                                manufacturingFingerprint: meshFingerprint,
                            },
                        });
                    } catch (error) {
                        mapChargeFailure(error);
                    }
                },
                deleteTemp: async () => {},
            }),
    });
    return {
        ok: true,
        outputType: "gcode",
        productionId: started.productionId,
        status: started.status,
        side: storedSide,
        sides,
        fileExtension: CNC_FILE_EXTENSION,
    };
}

async function assertReadableDesign(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal | null;
    user: SessionExportUser | null;
    designId: string;
}): Promise<void> {
    if (args.principal && !args.user) {
        await loadDogfoodDesign(args.prisma, args.principal, args.designId);
        return;
    }
    if (!args.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const denied = "Production not found or access denied";
    let design;
    try {
        const { repo, actor } = await openClientFiles(args.user);
        design = await assertDesignExportAccess(repo, actor, args.designId, denied);
    } catch (error) {
        if (error instanceof TRPCError) throw error;
        rethrowClientFile(error);
    }
    if (design.deletedAt) {
        throw new TRPCError({ code: "FORBIDDEN", message: denied });
    }
}

function hiddenFromOperator(principal: CadOperatorPrincipal | null, storageKey: string | null): boolean {
    if (!principal || !storageKey) return false;
    try {
        assertCadOperatorDeliverableKey(storageKey, principal.credentialId);
        return false;
    } catch {
        return true;
    }
}

export async function readCadOperatorProduction(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal | null;
    user: SessionExportUser | null;
    productionId: string;
    now?: Date;
}): Promise<PublicProduction> {
    const store = new PrismaCadProductionStore(args.prisma);
    const row = await store.findById(args.productionId);
    if (!row) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Production not found or access denied" });
    }
    await assertReadableDesign({
        prisma: args.prisma,
        principal: args.principal,
        user: args.user,
        designId: row.designId,
    });
    if (hiddenFromOperator(args.principal, row.gcodeStorageKey)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Production not found or access denied" });
    }
    const visible = (await expireStaleProduction(store, row.id, args.now ?? new Date())) ?? row;
    return toPublicProduction(visible);
}

export async function listCadOperatorProductions(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal | null;
    user: SessionExportUser | null;
    designId: string;
    side?: CadFootSide;
    presetId?: string;
    now?: Date;
}): Promise<{ productions: PublicProduction[] }> {
    await assertReadableDesign(args);
    const store = new PrismaCadProductionStore(args.prisma);
    const now = args.now ?? new Date();
    const rows = await store.listByDesign(args.designId, { side: args.side, presetId: args.presetId });
    const productions: PublicProduction[] = [];
    for (const row of rows) {
        if (hiddenFromOperator(args.principal, row.gcodeStorageKey)) continue;
        const visible = (await expireStaleProduction(store, row.id, now)) ?? row;
        productions.push(toPublicProduction(visible));
    }
    return { productions };
}
