// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// CAD-operator generateSolid: persist a production, return its id, slice later.

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import type { CadOperatorPrincipal } from "../auth/cad-operator.js";
import { assertCadOperatorGcodeKey, buildCadOperatorGcodeKey } from "../auth/cad-operator.js";
import { getSupabaseAdmin } from "../context.js";
import {
    beginCadOperatorProduction,
    type CadFootSide,
    type CadProductionStatus,
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
import { downloadManufacturingStl } from "../lib/manufacturing-stl-download.js";
import {
    archiveManufacturingSourceStl,
    deleteManufacturingTempBestEffort,
} from "../lib/manufacturing-stl-lifecycle.js";
import { MANUFACTURING_BUCKET, signedDownloadUrl, uploadAsset } from "../lib/storage.js";
import { assertActiveLicense, getUserTokenBalance, requireSupabaseAdmin } from "../lib/supabase-db.js";
import { sliceWithVertexSlice } from "../lib/vertexslice-client.js";
import {
    loadDogfoodDesign,
    materializeCadOperatorStl,
    prepareCadOperatorGenerate,
} from "./manufacturing-cad.js";

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
    });
    const store = new PrismaCadProductionStore(args.prisma);
    const now = args.now ?? (() => new Date());
    const started = await beginCadOperatorProduction({
        store,
        now: now(),
        schedule: args.schedule ?? scheduleCadProduction,
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
        execute: (row) =>
            executeCadOperatorProduction({
                row,
                store,
                now,
                materialize: () =>
                    materializeCadOperatorStl({
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
                    }),
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
                    const gcode = await sliceWithVertexSlice({
                        profileId: plan.presetId,
                        material: plan.material,
                        model: stlBytes,
                        filename: `${input.side}.stl`,
                        infillDensityPct,
                        sliceTimeoutMs,
                        side: input.side,
                    });
                    const jobStamp = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    return { gcode, jobId: `vs_${jobStamp}` };
                },
                uploadGcode: async (gcode) => {
                    const safeName = (input.fileName || `hybrid-${plan.presetId}.gcode`).replace(
                        /[^a-zA-Z0-9_.-]/g,
                        "_",
                    );
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
                            fileName: (input.fileName || `hybrid-${plan.presetId}.gcode`).replace(
                                /[^a-zA-Z0-9_.-]/g,
                                "_",
                            ),
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
            }),
    });
    return {
        ok: true,
        outputType: "gcode",
        productionId: started.productionId,
        status: started.status,
        side: started.side,
    };
}

async function assertReadableDesign(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal | null;
    userId: string | null;
    designId: string;
}): Promise<void> {
    if (args.principal && !args.userId) {
        await loadDogfoodDesign(args.prisma, args.principal, args.designId);
        return;
    }
    if (!args.userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const design = await args.prisma.design.findUnique({
        where: { id: args.designId },
        select: { ownerId: true, deletedAt: true },
    });
    if (!design || design.deletedAt || design.ownerId !== args.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Production not found or access denied" });
    }
}

function hiddenFromOperator(principal: CadOperatorPrincipal | null, storageKey: string | null): boolean {
    if (!principal || !storageKey) return false;
    try {
        assertCadOperatorGcodeKey(storageKey, principal.credentialId);
        return false;
    } catch {
        return true;
    }
}

export async function readCadOperatorProduction(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal | null;
    userId: string | null;
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
        userId: args.userId,
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
    userId: string | null;
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
