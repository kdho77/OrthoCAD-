// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Session-user generateSolid. Same synchronous charge-then-upload result as before.
// CAD-operator calls do not enter this function.

import { TRPCError } from "@trpc/server";
import {
    type Actor,
    ClientFileError,
    type ClientFileRepo,
    type DesignRow,
    getDesignFile,
} from "../../../shared/client-files.js";
import {
    gyroidInfillPctForHardness,
    isGyroidManufacturingPreset,
    migratePrintRecipe,
    PrintRecipeProfileRequiredError,
    type PrintRecipeV1,
    printRecipeToSnake,
    resolveGyroidManufacturingPrintRecipe,
} from "../../../shared/print-recipe/print-recipe.js";
import {
    selectVertexSliceUpload,
    vertexSliceRegional3mfEnabled,
} from "../../../shared/vertexslice-regional-3mf.js";
import { HYBRID_GCODE_COST } from "../lib/cad-operator-production.js";
import type { ManufacturePayload, ManufactureResult } from "../lib/manufacturing-client.js";
import { assertManufacturingTempKeyForUser } from "../lib/storage.js";
import { manufacturingBackendForOutput, type VertexSliceRequest } from "../lib/vertexslice-client.js";

export interface SessionManufactureInput {
    designId?: string;
    side?: "left" | "right";
    presetId: string;
    stlUrl?: string;
    stlStorageKey: string;
    outputType: "gcode" | "stl";
    beltAngleDeg: number;
    layerHeightMm?: number;
    infillDensity?: number;
    perimeters?: number;
    grindingStyle?: { type: "straight" | "rounded"; angle_degrees?: number; radius_mm?: number };
    printRecipe?: PrintRecipeV1;
    fileName?: string;
    material?: string;
    useSavedDesignMesh?: boolean;
    /**
     * Second upload. Present only when the design has effective regions.
     * The gate off refuses the export instead of slicing the STL.
     */
    regional3mfStorageKey?: string;
    expectedRegionCount?: number;
}

export interface SessionChargeArgs {
    p_user_id: string;
    p_cost: number;
    p_design_id: string | null;
    p_export_format: "gcode" | "stl";
    p_side: "left" | "right" | null;
    p_file_name: string;
    p_preset_id: string;
    p_belt_angle_deg: number;
    p_layer_height_mm: number | null;
    p_is_gcode: boolean;
    p_storage_key: string | null;
    p_job_id: string;
    p_ip: string | null;
    p_metadata: Record<string, unknown>;
}

export interface SessionChargeResult {
    productionId: string | null;
    exportId: string;
    balance: number;
    jobId: string;
}

/**
 * Same door as design.save: getDesignFile → canAccessOrg.
 * Tenant match or super_admin may export a design they did not create.
 * A missing design and a different-tenant read both stay FORBIDDEN.
 * License and token charge stay on the exporting user; this function does not charge.
 */
export async function assertDesignExportAccess(
    repo: ClientFileRepo,
    actor: Actor,
    designId: string,
    deniedMessage = "Design not found or access denied",
): Promise<DesignRow> {
    try {
        return await getDesignFile(repo, actor, designId);
    } catch (error) {
        if (error instanceof ClientFileError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) {
            throw new TRPCError({ code: "FORBIDDEN", message: deniedMessage });
        }
        throw error;
    }
}

export interface SessionManufacturingIo {
    assertActiveLicense(userId: string): Promise<void>;
    /** Org access for designId, not designs.ownerId === userId. */
    verifyDesignOwner(designId: string, userId: string): Promise<void>;
    getTokenBalance(userId: string): Promise<number>;
    storageAvailable(): boolean;
    signedDownloadUrl(storageKey: string): Promise<string>;
    downloadStl(url: string): Promise<Uint8Array>;
    sliceWithVertexSlice(request: VertexSliceRequest): Promise<string>;
    callManufacture(payload: ManufacturePayload): Promise<ManufactureResult>;
    charge(args: SessionChargeArgs): Promise<SessionChargeResult>;
    uploadOutput(storageKey: string, bytes: Buffer, contentType: string): Promise<void>;
    signedOutputUrl(storageKey: string): Promise<string>;
    updateExportStorage(exportId: string, storageKey: string): Promise<void>;
    updateProductionGcode(productionId: string, storageKey: string): Promise<void>;
    archiveSourceStl(args: { userId: string; exportId: string; tempStlKey: string }): Promise<void>;
    deleteTemp(storageKey: string): Promise<void>;
}

/**
 * Human UI path. Awaits slice and charge, then returns the historical result.
 * There is no production status field on this object.
 */
export async function runSessionGenerateSolid(args: {
    userId: string;
    ip: string | null;
    input: SessionManufactureInput;
    io: SessionManufacturingIo;
}): Promise<{
    ok: true;
    outputType: "gcode" | "stl";
    productionId: string | null;
    exportId: string;
    balance: number;
    jobId: string;
    downloadUrl: string | undefined;
    gcode: string | undefined;
    stlBase64: string | undefined;
    gcodeDownloadUrl: string | undefined;
    gcodeStorageKey: string | undefined;
    gcodeBase64: undefined;
}> {
    const { input, io } = args;
    const stlStorageKey = input.stlStorageKey;
    const presetId = input.presetId;
    const printRecipe = input.printRecipe;
    const material = input.material;
    const beltAngleDeg = input.beltAngleDeg;
    const requestedOutputType = input.outputType;
    const actorUserId = args.userId;
    const manufacturingFingerprint: string | null = null;

    console.log("[manufacturing] generateSolid request", {
        userId: actorUserId,
        cadOperator: null,
        designId: input.designId ?? null,
        side: input.side ?? null,
        presetId,
        outputType: requestedOutputType,
        beltAngleDeg,
        stlStorageKey,
        useSavedDesignMesh: input.useSavedDesignMesh === true,
    });

    if (!presetId || !stlStorageKey) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Missing required manufacturing parameters (stlStorageKey, presetId)",
        });
    }

    const gyroidPreset = isGyroidManufacturingPreset(presetId);
    if (gyroidPreset && input.infillDensity !== undefined && !printRecipe) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message:
                "Legacy infillDensity is not accepted for gyroid manufacturing presets. " +
                "Upgrade the design with PrintRecipeV1 (named hardness) and resend printRecipe.",
        });
    }

    let resolvedPrintRecipe: ReturnType<typeof migratePrintRecipe> | undefined;
    if (gyroidPreset) {
        try {
            resolvedPrintRecipe = resolveGyroidManufacturingPrintRecipe(presetId, printRecipe);
        } catch (error) {
            if (error instanceof PrintRecipeProfileRequiredError) {
                throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
            }
            throw error;
        }
        if (presetId !== resolvedPrintRecipe.profileId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "presetId must match PrintRecipeV1.profileId for production gyroid manufacturing.",
            });
        }
    } else if (printRecipe) {
        resolvedPrintRecipe = migratePrintRecipe(printRecipe);
    }

    try {
        assertManufacturingTempKeyForUser(stlStorageKey, actorUserId);
    } catch {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid manufacturing STL storage key",
        });
    }

    const tempStlKey = stlStorageKey;
    let regionalTempKey: string | null = null;

    try {
        await io.assertActiveLicense(actorUserId);
        const cost = HYBRID_GCODE_COST;

        if (input.designId) {
            await io.verifyDesignOwner(input.designId, actorUserId);
        }

        const balance = await io.getTokenBalance(actorUserId);
        if (balance < cost) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
        }

        let stlUrl = input.stlUrl;
        if (!stlUrl) {
            if (!io.storageAvailable()) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Storage not available",
                });
            }
            stlUrl = await io.signedDownloadUrl(stlStorageKey);
        }

        const jobStamp = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let outputBytes: Buffer;
        let outputType: "gcode" | "stl";
        let jobId: string;
        let inlineGcode: string | undefined;
        let inlineStl: string | undefined;

        if (manufacturingBackendForOutput(requestedOutputType) === "vertexslice") {
            if (!resolvedPrintRecipe) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                        "Printer G-code requires PrintRecipe hardness so gyroid infill stays on the locked profile.",
                });
            }
            const infillDensityPct = gyroidInfillPctForHardness(
                resolvedPrintRecipe.defaultHardness,
                resolvedPrintRecipe.hardnessToInfillPct,
            );
            const stlBytes = await io.downloadStl(stlUrl);
            const regionalGate = vertexSliceRegional3mfEnabled();
            const claimedCount = input.expectedRegionCount;
            const claimedRegions = claimedCount !== undefined || Boolean(input.regional3mfStorageKey);
            let regional3mf: { bytes: Uint8Array; regionCount: number } | null = null;
            if (claimedRegions && !regionalGate) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                        "Regional hardness is turned off on this server. Refusing a single-density print.",
                });
            }
            if (regionalGate && claimedRegions) {
                if (claimedCount === undefined) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message:
                            "Regional hardness was requested but the modifier count is missing. Refusing a single-density print.",
                    });
                }
                if (!input.regional3mfStorageKey) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: `Regional hardness is enabled but no modifier 3MF was uploaded (${claimedCount} regions). Refusing a single-density print.`,
                    });
                }
                try {
                    assertManufacturingTempKeyForUser(input.regional3mfStorageKey, actorUserId);
                } catch {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "Invalid regional 3MF storage key",
                    });
                }
                regionalTempKey = input.regional3mfStorageKey;
                const regionalUrl = await io.signedDownloadUrl(input.regional3mfStorageKey);
                regional3mf = { bytes: await io.downloadStl(regionalUrl), regionCount: claimedCount };
            }
            const upload = selectVertexSliceUpload({
                stl: stlBytes,
                stlFilename: `${input.side ?? "model"}.stl`,
                regional3mf,
                regional3mfEnabled: regionalGate,
            });
            const gcode = await io.sliceWithVertexSlice({
                profileId: presetId,
                material: material ?? "",
                model: upload.bytes,
                filename: upload.filename,
                infillDensityPct,
                expectedRegionCount: upload.expectedRegionCount,
            });
            outputBytes = Buffer.from(gcode, "utf-8");
            outputType = "gcode";
            jobId = `vs_${jobStamp}`;
            inlineGcode = gcode;
        } else {
            const pythonResult = await io.callManufacture({
                job_id: jobStamp,
                design_id: input.designId ?? "adhoc",
                preset_id: presetId,
                stl_url: stlUrl,
                output_type: requestedOutputType,
                belt_angle_deg: beltAngleDeg,
                side: input.side ?? null,
                layer_height_mm: input.layerHeightMm,
                infill_density: resolvedPrintRecipe ? undefined : input.infillDensity,
                perimeters: input.perimeters,
                grinding_style: input.grindingStyle,
                print_recipe: resolvedPrintRecipe ? printRecipeToSnake(resolvedPrintRecipe) : undefined,
                ...(material ? { material } : {}),
            });
            outputType = pythonResult.output_type ?? requestedOutputType;
            inlineGcode = pythonResult.gcode;
            inlineStl = pythonResult.stl_base64;
            jobId = pythonResult.job_id ?? jobStamp;
            outputBytes =
                outputType === "gcode"
                    ? Buffer.from(pythonResult.gcode ?? "", "utf-8")
                    : Buffer.from(pythonResult.stl_base64 ?? "", "base64");
        }

        const isGcode = outputType === "gcode";
        const exportFormat = isGcode ? "gcode" : "stl";

        if (outputBytes.length === 0) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Manufacturing service returned empty output",
            });
        }

        const defaultName = isGcode ? `hybrid-${presetId}.gcode` : `hybrid-${presetId}.stl`;
        const safeName = (input.fileName || defaultName).replace(/[^a-zA-Z0-9_.-]/g, "_");
        const storagePrefix = isGcode ? "gcode" : "manufacturing-output";
        const storageKey = `${storagePrefix}/${input.designId || "adhoc"}/${Date.now()}-${safeName}`;
        const contentType = isGcode ? "text/plain" : "model/stl";

        if (!io.storageAvailable()) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Supabase admin client not configured",
            });
        }

        const result = await io.charge({
            p_user_id: actorUserId,
            p_cost: cost,
            p_design_id: input.designId ?? null,
            p_export_format: exportFormat,
            p_side: input.side ?? null,
            p_file_name: safeName,
            p_preset_id: presetId,
            p_belt_angle_deg: beltAngleDeg,
            p_layer_height_mm: input.layerHeightMm ?? null,
            p_is_gcode: isGcode,
            p_storage_key: isGcode ? storageKey : null,
            p_job_id: jobId,
            p_ip: args.ip,
            p_metadata: {
                kind: "manufacturing_hybrid",
                outputType,
                presetId,
                beltAngleDeg,
                grindingStyle: input.grindingStyle?.type ?? null,
                material: material ?? null,
                manufacturingFingerprint,
                cadOperatorCredentialId: null,
                slicer: isGcode ? "vertexslice" : "python",
                side: input.side ?? null,
                layerHeightMm: input.layerHeightMm ?? null,
                infillDensity: resolvedPrintRecipe ? null : (input.infillDensity ?? null),
                printRecipe: resolvedPrintRecipe ?? null,
                perimeters: input.perimeters ?? null,
                sourceStlTempKey: tempStlKey,
            },
        });

        let downloadUrl: string | undefined;
        if (io.storageAvailable()) {
            await io.uploadOutput(storageKey, outputBytes, contentType);
            downloadUrl = await io.signedOutputUrl(storageKey);
            await io.updateExportStorage(result.exportId, storageKey);
            if (result.productionId && isGcode) {
                await io.updateProductionGcode(result.productionId, storageKey);
            }
        }

        await io.archiveSourceStl({
            userId: actorUserId,
            exportId: result.exportId,
            tempStlKey,
        });
        if (regionalTempKey) await io.deleteTemp(regionalTempKey);

        console.log("[manufacturing] generateSolid success", {
            userId: actorUserId,
            productionId: result.productionId,
            exportId: result.exportId,
            balance: result.balance,
            outputType,
            stored: Boolean(downloadUrl),
        });

        return {
            ok: true as const,
            outputType,
            productionId: result.productionId,
            exportId: result.exportId,
            balance: result.balance,
            jobId: result.jobId,
            downloadUrl,
            gcode: isGcode && !downloadUrl ? inlineGcode : undefined,
            stlBase64: isGcode || downloadUrl ? undefined : inlineStl,
            gcodeDownloadUrl: isGcode ? downloadUrl : undefined,
            gcodeStorageKey: isGcode ? storageKey : undefined,
            gcodeBase64: undefined,
        };
    } catch (error) {
        await io.deleteTemp(tempStlKey);
        if (regionalTempKey) await io.deleteTemp(regionalTempKey);
        throw error;
    }
}
