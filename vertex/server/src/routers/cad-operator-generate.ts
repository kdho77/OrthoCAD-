// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// CAD-operator generateSolid: persist a production, return its id, slice later.

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import {
    buildExportFilename,
    canonicalExportMaterialName,
    cncPairGcodeFilename,
    exportSideSuffix,
} from "../../../shared/export-filename.js";
import {
    bindPrintRecipeProfile,
    migratePrintRecipe,
    printRecipeV1Schema,
} from "../../../shared/print-recipe/print-recipe.js";
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
    CAD_PRODUCTION_LEASE_MS,
    type CadFootSide,
    type CadProductionRow,
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
    readSliceCheckpoint,
    runCadSliceAttempt,
    SLICE_JOB_POLL_BUDGET_MS,
    scheduleCadProduction,
    sleepMs,
    toPublicProduction,
} from "../lib/cad-operator-production.js";
import { chargeExistingProduction, PrismaCadProductionStore } from "../lib/cad-operator-production-prisma.js";
import { openClientFiles, rethrowClientFile } from "../lib/client-file-access.js";
import { buildHeadlessMillCncGcode, prepareHeadlessMillDesign } from "../lib/cnc-mill-runner.js";
import {
    envelopeWithLoftTextMarking,
    patientDisplayName,
    resolveProductionTextMarking,
} from "../lib/integration-text-marking.js";
import { manufacturingStlRunIdentity } from "../lib/manufacturing-stl-identity.js";
import {
    archiveManufacturingSourceStl,
    deleteManufacturingTempBestEffort,
} from "../lib/manufacturing-stl-lifecycle.js";
import { deleteAsset, MANUFACTURING_BUCKET, uploadAsset } from "../lib/storage.js";
import { assertActiveLicense, getUserTokenBalance, requireSupabaseAdmin } from "../lib/supabase-db.js";
import { getVertexSliceBuild, UNKNOWN_SLICER_BUILD } from "../lib/vertexslice-build.js";
import type { VertexSliceRequest } from "../lib/vertexslice-client.js";
import {
    type CadGeneratePlan,
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

/**
 * Saved-design belt STL identity. The hash is the full saved design plus the
 * belt frame, placement version, and slicer version. Any design change misses.
 */
export function beltManufacturingStlIdentity(
    settingsJson: unknown,
    side: CadFootSide,
    slicerVersion?: string | null,
): string {
    return manufacturingStlRunIdentity({
        side,
        savedDesign: readStoredDesignSettings(settingsJson) ?? settingsJson,
        beltPrint: true,
        slicerVersion: slicerVersion ?? undefined,
    });
}

async function beltSliceRequest(args: {
    stlBytes: Uint8Array;
    side: CadFootSide;
    plan: Awaited<ReturnType<typeof prepareCadOperatorGenerate>>;
    regional3mf: { bytes: Uint8Array; regionCount: number } | null;
    sliceTimeoutMs: number | undefined;
}): Promise<VertexSliceRequest> {
    const upload = selectVertexSliceUpload({
        stl: args.stlBytes,
        stlFilename: `${args.side}.stl`,
        regional3mf: args.regional3mf,
        regional3mfEnabled: vertexSliceRegional3mfEnabled(),
    });
    return {
        profileId: args.plan.presetId,
        material: args.plan.material,
        model: upload.bytes,
        filename: upload.filename,
        infillDensityPct: infillPctForCadSlice(args.plan.presetId, args.plan.printRecipe),
        expectedRegionCount: upload.expectedRegionCount,
        sliceTimeoutMs: args.sliceTimeoutMs,
        side: args.side,
    };
}

async function continueInFlightSlice(args: {
    prisma: PrismaClient;
    store: PrismaCadProductionStore;
    row: CadProductionRow;
    now: Date;
}): Promise<void> {
    const stored = readSliceCheckpoint(args.row.error);
    // No checkpoint means this read has nothing to resume. A fresh loft is
    // started by generate_gcode, which still has the caller credential.
    if (!stored) return;
    if (args.row.status !== "pending" && args.row.status !== "running") return;
    const side = args.row.side;
    const design = await args.prisma.design.findUnique({
        where: { id: args.row.designId },
        select: {
            ownerId: true,
            settingsJson: true,
            client: { select: { firstName: true, lastName: true } },
        },
    });
    const fileName = `${side ?? "pair"}-${args.row.id}.gcode`;
    const canRematerialize = Boolean(design?.ownerId) && (side === "left" || side === "right");
    let settingsJson: unknown = design?.settingsJson;
    let stlIdentity: string | null = null;
    let plan: CadGeneratePlan | null = null;
    if (canRematerialize && design && (side === "left" || side === "right")) {
        const clientName = patientDisplayName(design.client?.firstName ?? "", design.client?.lastName ?? "");
        const resolved = resolveProductionTextMarking({
            settingsJson: design.settingsJson,
            clientDisplayName: clientName,
        });
        settingsJson = envelopeWithLoftTextMarking(resolved.envelope, resolved.patientDisplayName, side);
        const slicerBuild = await getVertexSliceBuild();
        stlIdentity = beltManufacturingStlIdentity(settingsJson, side, slicerBuild ?? UNKNOWN_SLICER_BUILD);
        const parsedRecipe = printRecipeV1Schema.safeParse(
            readStoredDesignSettings(settingsJson)?.printRecipe,
        );
        plan = {
            stlStorageKey: null,
            presetId: args.row.presetId,
            printRecipe: bindPrintRecipeProfile(
                parsedRecipe.success ? parsedRecipe.data : undefined,
                args.row.presetId,
            ),
            material: args.row.material,
            beltAngleDeg: args.row.beltAngleDeg,
            ownerId: design.ownerId,
            useSavedDesignMesh: true,
            settingsJson,
            clientFirstName: design.client?.firstName ?? "",
            clientLastName: design.client?.lastName ?? "",
        };
    }
    let regional3mf: { bytes: Uint8Array; regionCount: number } | null = null;
    let loftBytes: Uint8Array | null = null;
    let loftKey: string | null = null;
    await executeCadOperatorProduction({
        row: args.row,
        store: args.store,
        now: () => args.now,
        sliceBudgetMs: 0,
        stlIdentity,
        // A checkpoint that was not written after a loft is a stored STL.
        // Do not poll that job and do not download its file. materialize lofts.
        resumeSubmittedSlice: stored.rematerialized === true,
        materialize: async () => {
            if (!plan || (side !== "left" && side !== "right")) {
                throw new Error("Stale slice checkpoint cannot be rematerialized");
            }
            const materialized = await materializeCadOperatorStl({
                plan,
                credentialId: stored.credentialId,
                side,
                uploadStl: async (key, bytes) => {
                    await uploadAsset(requireStorage(), key, bytes, "model/stl", MANUFACTURING_BUCKET);
                },
            });
            regional3mf = materialized.regional3mf;
            loftBytes = materialized.stlBytes;
            loftKey = materialized.stlStorageKey;
            return {
                stlStorageKey: materialized.stlStorageKey,
                meshFingerprint: materialized.meshFingerprint,
            };
        },
        slice: async (_storedKey, sliceCtx) => {
            const resume = sliceCtx?.checkpoint ?? null;
            const bytes = loftBytes;
            const attempt = await runCadSliceAttempt({
                request:
                    resume || !bytes || !plan || (side !== "left" && side !== "right")
                        ? null
                        : await beltSliceRequest({
                              stlBytes: bytes,
                              side,
                              plan,
                              regional3mf,
                              sliceTimeoutMs: sliceCtx?.invocationStartedAt
                                  ? cadVertexSliceSliceTimeoutMs(sliceCtx.invocationStartedAt, args.now)
                                  : sliceCtx?.sliceTimeoutMs,
                          }),
                checkpoint: resume,
                stlStorageKey: loftKey ?? "",
                meshFingerprint: sliceCtx?.meshFingerprint ?? stored.meshFingerprint,
                stlIdentity,
                credentialId: stored.credentialId,
                side: args.row.side,
                now: sliceCtx?.now ?? (() => args.now),
                sleep: sliceCtx?.sleep ?? sleepMs,
                budgetMs: sliceCtx?.budgetMs ?? 0,
                persistCheckpoint: sliceCtx?.persistCheckpoint,
            });
            if (attempt.kind === "pending") return { pending: true, checkpoint: attempt.checkpoint };
            return { gcode: attempt.gcode, jobId: attempt.jobId };
        },
        uploadGcode: async (gcode) => {
            const storageKey = buildCadOperatorGcodeKey(stored.credentialId, args.row.designId, fileName);
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
            if (!design?.ownerId) throw new Error("Manufacturing charge failed");
            try {
                return await chargeExistingProduction(args.prisma, {
                    userId: design.ownerId,
                    cost: HYBRID_GCODE_COST,
                    productionId: args.row.id,
                    designId: args.row.designId,
                    exportFormat: "gcode",
                    side: args.row.side,
                    fileName,
                    presetId: args.row.presetId,
                    beltAngleDeg: args.row.beltAngleDeg,
                    layerHeightMm: args.row.layerHeightMm,
                    isGcode: true,
                    storageKey,
                    jobId,
                    ip: null,
                    metadata: {
                        kind: "manufacturing_hybrid",
                        outputType: "gcode",
                        presetId: args.row.presetId,
                        beltAngleDeg: args.row.beltAngleDeg,
                        material: args.row.material,
                        manufacturingFingerprint: meshFingerprint,
                        slicer: "vertexslice",
                        side: args.row.side,
                        source: "cad_operator_slice_job",
                    },
                });
            } catch (error) {
                mapChargeFailure(error);
            }
        },
        deleteTemp: async (stlStorageKey) => {
            deleteManufacturingTempBestEffort(getSupabaseAdmin(), stlStorageKey);
        },
    });
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
    // Cached G-code is reused only when the same slicer build made it. Unknown build: never reuse.
    const slicerBuild = await getVertexSliceBuild();
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
        slicerBuild: slicerBuild ?? UNKNOWN_SLICER_BUILD,
    });
    const stlIdentity = plan.useSavedDesignMesh
        ? beltManufacturingStlIdentity(plan.settingsJson, input.side, slicerBuild ?? UNKNOWN_SLICER_BUILD)
        : null;
    const store = new PrismaCadProductionStore(args.prisma);
    const now = args.now ?? (() => new Date());
    const started = await beginCadOperatorProduction({
        store,
        now: now(),
        schedule: args.schedule ?? scheduleCadProduction,
        forceNewSlice: input.useSavedDesignMesh === true || slicerBuild === null,
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
            let loftBytes: Uint8Array | null = null;
            let loftKey: string | null = null;
            return executeCadOperatorProduction({
                row,
                store,
                now,
                stlIdentity,
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
                    loftBytes = materialized.stlBytes;
                    loftKey = materialized.stlStorageKey;
                    return {
                        stlStorageKey: materialized.stlStorageKey,
                        meshFingerprint: materialized.meshFingerprint,
                    };
                },
                slice: async (_storedKey, sliceCtx) => {
                    const bytes = loftBytes;
                    const attempt = await runCadSliceAttempt({
                        request:
                            sliceCtx?.checkpoint || !bytes
                                ? null
                                : await beltSliceRequest({
                                      stlBytes: bytes,
                                      side: input.side,
                                      plan,
                                      regional3mf,
                                      sliceTimeoutMs: sliceCtx?.invocationStartedAt
                                          ? cadVertexSliceSliceTimeoutMs(sliceCtx.invocationStartedAt, now())
                                          : sliceCtx?.sliceTimeoutMs,
                                  }),
                        checkpoint: sliceCtx?.checkpoint ?? null,
                        stlStorageKey: loftKey ?? "",
                        meshFingerprint: sliceCtx?.meshFingerprint ?? null,
                        stlIdentity,
                        credentialId: sliceCtx?.checkpoint?.credentialId ?? args.principal.credentialId,
                        side: input.side,
                        now: sliceCtx?.now ?? now,
                        sleep: sliceCtx?.sleep ?? sleepMs,
                        budgetMs: sliceCtx?.budgetMs ?? SLICE_JOB_POLL_BUDGET_MS,
                        persistCheckpoint: sliceCtx?.persistCheckpoint,
                    });
                    if (attempt.kind === "pending") return { pending: true, checkpoint: attempt.checkpoint };
                    return { gcode: attempt.gcode, jobId: attempt.jobId };
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
    input: { designId: string; material?: string; millSide?: "LR" | "RR" | "LL" };
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
        prepared = await prepareHeadlessMillDesign(
            {
                id: design.id,
                pattern: design.pattern,
                method: design.method,
                thicknessMm: design.thicknessMm,
                linked: design.linked,
                unit: design.unit,
                createdAt: updatedAt,
                updatedAt,
                settingsJson: design.settingsJson,
            },
            { millSide: args.input.millSide },
        );
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
    const fileName = cncPairGcodeFilename({
        firstName: row.client.firstName ?? "",
        lastName: row.client.lastName ?? "",
        material: args.input.material,
        sides,
        millSide: args.input.millSide,
    });
    const exportMaterial = canonicalExportMaterialName(args.input.material);
    const identity = cadOperatorManufacturingIdentity({
        designId: args.input.designId,
        side: anchor,
        presetId: CNC_GCODE_PRESET_ID,
        useSavedDesignMesh: true,
        material: exportMaterial,
        beltAngleDeg: 0,
        layerHeightMm: null,
        printRecipe,
        settingsJson: design.settingsJson,
        stlStorageKey: null,
        deliverable: "cnc_gcode",
        millSides: sides,
    });
    const storedSide: CadFootSide | null = sides.length === 1 ? (sides[0] ?? null) : null;
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
            material: exportMaterial,
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
                    const milled = await buildHeadlessMillCncGcode(prepared.design, {
                        millSide: args.input.millSide,
                    });
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
                        safeName,
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

/**
 * A job this production submitted after loft is polled here.
 * A checkpoint that still names a stored STL is not downloaded. The loft is
 * scheduled and this call returns the production id without waiting for it.
 */
async function followProduction(args: {
    prisma: PrismaClient;
    store: PrismaCadProductionStore;
    row: CadProductionRow;
    now: Date;
}): Promise<CadProductionRow> {
    const checkpoint = readSliceCheckpoint(args.row.error);
    if (checkpoint?.rematerialized === true) {
        await continueInFlightSlice(args);
    } else if (checkpoint) {
        const dropped = await args.store.updateIf(
            args.row.id,
            (current) => {
                const saved = readSliceCheckpoint(current.error);
                return saved != null && saved.rematerialized !== true;
            },
            {
                status: "pending",
                error: null,
                leaseExpiresAt: new Date(args.now.getTime() + CAD_PRODUCTION_LEASE_MS),
                updatedAt: args.now,
            },
        );
        if (dropped) {
            scheduleCadProduction(
                continueInFlightSlice({
                    ...args,
                    row: { ...args.row, status: "pending" },
                }),
            );
        }
    }
    const refreshed = (await args.store.findById(args.row.id)) ?? args.row;
    return (await expireStaleProduction(args.store, refreshed.id, args.now)) ?? refreshed;
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
    const now = args.now ?? new Date();
    const visible = await followProduction({ prisma: args.prisma, store, row, now });
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
        const visible = await followProduction({ prisma: args.prisma, store, row, now });
        productions.push(toPublicProduction(visible));
    }
    return { productions };
}
