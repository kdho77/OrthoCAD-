import type { IntegrationClient } from "../clients/integration-client.js";
import { IntegrationHttpError } from "../clients/integration-client.js";
import type { ManufacturingClient } from "../clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../config.js";
import { requireCadOperatorKey } from "../config.js";
import { buildDesignExportedPayload } from "../payload/design-exported-payload.js";
import { buildVoAttachFilesHandoff, DOGFOOD_HELD_ID_PREFIXES } from "../payload/vo-attach-files.js";
import {
    buildExportFilename,
    canonicalExportMaterialName,
    type ExportFilenameBase,
    exportSideSuffix,
    parsePatientNameForExport,
} from "../shared/export-filename.js";
import {
    callerPrintMaterial,
    callerPrintPreset,
    canonicalInsolePrintMaterialCatalog,
} from "./print-materials.js";
import {
    buildDesignExportedPayloadInputSchema,
    createSavedDesignInputSchema,
    generateCentralFabStlInputSchema,
    generateCncGcodeInputSchema,
    generateGcodeInputSchema,
    getDesignInputSchema,
    getDesignParamsInputSchema,
    getExportDownloadInputSchema,
    getProductionInputSchema,
    listDesignsByOrderInputSchema,
    listMaterialsInputSchema,
    listProductionsByDesignInputSchema,
    persistSavedDesignSnapshotInputSchema,
    prepareManufacturingStlUploadInputSchema,
    prepareVoAttachmentInputSchema,
} from "./schemas.js";

export interface OrthocadToolDeps {
    config: OrthocadMcpConfig;
    integration?: IntegrationClient;
    manufacturing?: ManufacturingClient;
}

interface SavedDesignGcodeFile {
    side: "left" | "right";
    format: "gcode";
    production_id: string | null;
    download_url: string | null;
    storage_key: string | null;
    content_base64: string | null;
    filename?: string;
}

function mcpGcodeExportFilename(
    side: "left" | "right",
    patientName: string | undefined,
    material: string | undefined,
    fileNameOverride?: string,
    base?: ExportFilenameBase | null,
): string {
    if (fileNameOverride?.trim()) return fileNameOverride.trim();
    const patient = parsePatientNameForExport(patientName);
    return buildExportFilename({
        firstName: patient.firstName,
        lastName: patient.lastName,
        material: canonicalExportMaterialName(material),
        side: exportSideSuffix(side, base),
        ext: "gcode",
    });
}

interface UserQuestion {
    ok: false;
    ask: "user";
    relay: "none";
    questions: Array<{ field: string; prompt: string }>;
}

function isUserQuestion(value: unknown): value is UserQuestion {
    if (!value || typeof value !== "object") return false;
    const row = value as { ok?: unknown; ask?: unknown };
    return row.ok === false && row.ask === "user";
}

function questionFromMessage(message: string): UserQuestion | null {
    if (/on hold/i.test(message)) return null;
    if (/shoe size/i.test(message) && /refus|required|invent|cannot be lofted/i.test(message)) {
        return {
            ok: false,
            ask: "user",
            relay: "none",
            questions: [
                {
                    field: "shoe_size",
                    prompt: "Shoe size is not on this order. What US men's or US women's size should this pair use?",
                },
            ],
        };
    }
    if (/hardness/i.test(message) && /refus|guess|known/i.test(message)) {
        return {
            ok: false,
            ask: "user",
            relay: "none",
            questions: [
                {
                    field: "hardness",
                    prompt: "Material hardness is not a known value. Which hardness should this pair use: Extra Soft, Soft, Medium, Hard, or Extra Hard?",
                },
            ],
        };
    }
    return null;
}

function assertToolNotHeld(value: string): void {
    const id = value.trim().toLowerCase();
    for (const prefix of DOGFOOD_HELD_ID_PREFIXES) {
        if (id === prefix || id.startsWith(prefix)) {
            throw new Error("This order is on hold and is not available to the dogfood path.");
        }
    }
}

const PRODUCTION_STATUSES = new Set(["pending", "running", "succeeded", "failed"]);
const PRODUCTION_TERMINAL_STATUSES = new Set(["succeeded", "failed"]);
/** In-process get_production polling interval when wait_s > 0. */
const GET_PRODUCTION_POLL_INTERVAL_MS = 2000;

function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getProductionWithOptionalWait(
    manufacturing: ManufacturingClient,
    productionId: string,
    waitS: number,
): Promise<ReturnType<typeof publicProductionFromResult>> {
    let result = await manufacturing.getProduction(productionId);
    let payload = publicProductionFromResult(result);
    if (waitS <= 0) return payload;
    const deadline = Date.now() + waitS * 1000;
    while (!PRODUCTION_TERMINAL_STATUSES.has(payload.status ?? "")) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleepMs(Math.min(GET_PRODUCTION_POLL_INTERVAL_MS, remaining));
        if (Date.now() >= deadline) break;
        result = await manufacturing.getProduction(productionId);
        payload = publicProductionFromResult(result);
    }
    return payload;
}

function textField(result: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
        const value = result[key];
        if (typeof value === "string") return value;
    }
    return null;
}

/** Only the public production fields. Drops names, settings, and G-code bytes. */
export function publicProductionFromResult(result: Record<string, unknown>): {
    production_id: string | null;
    design_id: string | null;
    side: "left" | "right" | null;
    preset_id: string | null;
    status: string | null;
    created_at: string | null;
    updated_at: string | null;
    gcode_storage_key: string | null;
    error: string | null;
    download: { tool: "get_export_download"; production_id: string } | null;
} {
    const productionId = textField(result, "productionId", "production_id");
    const side = result.side === "left" || result.side === "right" ? result.side : null;
    const status =
        typeof result.status === "string" && PRODUCTION_STATUSES.has(result.status) ? result.status : null;
    const downloadRecord =
        result.download && typeof result.download === "object"
            ? (result.download as Record<string, unknown>)
            : null;
    const downloadId = downloadRecord ? textField(downloadRecord, "productionId", "production_id") : null;
    return {
        production_id: productionId,
        design_id: textField(result, "designId", "design_id"),
        side,
        preset_id: textField(result, "presetId", "preset_id"),
        status,
        created_at: textField(result, "createdAt", "created_at"),
        updated_at: textField(result, "updatedAt", "updated_at"),
        gcode_storage_key: textField(result, "gcodeStorageKey", "gcode_storage_key"),
        error: textField(result, "error"),
        download:
            status === "succeeded" && productionId
                ? { tool: "get_export_download", production_id: downloadId ?? productionId }
                : null,
    };
}

function gcodeFileFromResult(
    side: "left" | "right",
    result: Record<string, unknown>,
    filename?: string,
):
    | SavedDesignGcodeFile
    | {
          side: "left" | "right";
          production_id: string | null;
          status: string;
      } {
    const status =
        typeof result.status === "string" && PRODUCTION_STATUSES.has(result.status) ? result.status : null;
    if (status) {
        const productionId = textField(result, "productionId", "production_id");
        return { side, production_id: productionId, status };
    }
    const productionId = typeof result.productionId === "string" ? result.productionId : null;
    const download =
        typeof result.gcodeDownloadUrl === "string"
            ? result.gcodeDownloadUrl
            : typeof result.downloadUrl === "string"
              ? result.downloadUrl
              : null;
    const storageKey =
        typeof result.gcodeStorageKey === "string"
            ? result.gcodeStorageKey
            : typeof result.storageKey === "string"
              ? result.storageKey
              : null;
    const contentBase64 =
        typeof result.gcodeBase64 === "string"
            ? result.gcodeBase64
            : typeof result.gcode === "string" && result.gcode.length > 0
              ? Buffer.from(result.gcode, "utf8").toString("base64")
              : null;
    return {
        side,
        format: "gcode",
        production_id: productionId,
        download_url: download,
        storage_key: storageKey,
        content_base64: contentBase64,
        ...(filename ? { filename } : {}),
    };
}

function integrationNotReady(error: unknown): string {
    if (error instanceof IntegrationHttpError && (error.status === 404 || error.status === 405)) {
        return (
            `${error.message} Integration read GET routes are Phase B — add handlers in ` +
            "vertex/server/src/routers/integrations/http.ts wired to IntegrationStore.getDesign / findDesignLink."
        );
    }
    return error instanceof Error ? error.message : String(error);
}

export async function handleOrthocadTool(
    name: string,
    args: unknown,
    deps: OrthocadToolDeps,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    try {
        const payload = await dispatchTool(name, args, deps);
        return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: integrationNotReady(error) }],
        };
    }
}

async function dispatchTool(name: string, args: unknown, deps: OrthocadToolDeps): Promise<unknown> {
    switch (name) {
        case "get_design": {
            const input = getDesignInputSchema.parse(args);
            const integration =
                deps.integration ??
                (await import("../clients/integration-client.js")).createIntegrationClient({
                    apiBase: deps.config.apiBase,
                    apiKey: requireCadOperatorKey(deps.config),
                });
            return integration.getDesign(input.design_id);
        }
        case "list_designs_by_order": {
            const input = listDesignsByOrderInputSchema.parse(args);
            const integration =
                deps.integration ??
                (await import("../clients/integration-client.js")).createIntegrationClient({
                    apiBase: deps.config.apiBase,
                    apiKey: requireCadOperatorKey(deps.config),
                });
            return integration.listDesignsByOrder(input);
        }
        case "get_design_params": {
            const input = getDesignParamsInputSchema.parse(args);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            return manufacturing.getDesignParams(input.design_id);
        }
        case "prepare_manufacturing_stl_upload": {
            const input = prepareManufacturingStlUploadInputSchema.parse(args);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            return manufacturing.prepareManufacturingStlUpload({
                side: input.side,
                fileName: input.file_name,
            });
        }
        case "list_materials": {
            listMaterialsInputSchema.parse(args ?? {});
            return canonicalInsolePrintMaterialCatalog();
        }
        case "generate_gcode": {
            const input = generateGcodeInputSchema.parse(args);
            const material = callerPrintMaterial(input.material);
            const presetId = callerPrintPreset(input.preset_id);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            if (input.use_saved_design) {
                const designId = input.design_id;
                if (!designId) throw new Error("design_id is required");
                assertToolNotHeld(designId);
                if (input.output_type === "stl") {
                    throw new Error("Saved-design manufacturing returns G-code only");
                }
                const sides = input.side ? [input.side] : (["left", "right"] as const);
                const exportBase: ExportFilenameBase | null = input.base_asset_id?.trim()
                    ? { assetId: input.base_asset_id.trim() }
                    : null;
                const pairEnqueue = sides.length > 1;
                const sideOutcomes = await Promise.all(
                    sides.map(async (side) => {
                        const exportFileName = mcpGcodeExportFilename(
                            side,
                            input.patient_name,
                            material,
                            input.file_name,
                            exportBase,
                        );
                        try {
                            const result = await manufacturing.generateFromSavedDesign({
                                designId,
                                side,
                                presetId,
                                material,
                                fileName: exportFileName,
                                patientName: input.patient_name,
                                hardness: input.hardness,
                                forceNewSlice: input.force_new_slice === true,
                            });
                            return { side, exportFileName, result, error: null as Error | null };
                        } catch (error) {
                            return {
                                side,
                                exportFileName,
                                result: null,
                                error: error instanceof Error ? error : new Error(String(error)),
                            };
                        }
                    }),
                );
                const files: Array<ReturnType<typeof gcodeFileFromResult>> = [];
                for (const entry of sideOutcomes) {
                    if (entry.error) {
                        if (pairEnqueue) {
                            throw new Error(
                                `Belt pair failed on the ${entry.side} foot. No partial pair is returned. ${entry.error.message}`,
                            );
                        }
                        throw entry.error;
                    }
                    const result = entry.result!;
                    if (isUserQuestion(result)) {
                        const partialSuccess = sideOutcomes.some(
                            (other) =>
                                other !== entry &&
                                other.result &&
                                !isUserQuestion(other.result) &&
                                !other.error,
                        );
                        if (files.length > 0 || partialSuccess) {
                            throw new Error(
                                `Belt pair failed on the ${entry.side} foot. No partial pair is returned.`,
                            );
                        }
                        return result;
                    }
                    files.push(gcodeFileFromResult(entry.side, result, entry.exportFileName));
                }
                if (files.length !== sides.length) {
                    throw new Error("Belt pair did not produce both feet");
                }
                return { ok: true, format: "gcode", files };
            }
            if (!input.stl_storage_key) {
                throw new Error("stl_storage_key is required unless use_saved_design");
            }
            const legacyExportBase: ExportFilenameBase | null = input.base_asset_id?.trim()
                ? { assetId: input.base_asset_id.trim() }
                : null;
            const legacyExportFileName = mcpGcodeExportFilename(
                input.side ?? "left",
                input.patient_name,
                material,
                input.file_name,
                legacyExportBase,
            );
            const legacy = await manufacturing.generateGcode({
                designId: input.design_id,
                side: input.side,
                presetId,
                stlStorageKey: input.stl_storage_key,
                outputType: input.output_type,
                beltAngleDeg: input.belt_angle_deg,
                fileName: legacyExportFileName,
                material,
                patientName: input.patient_name,
            });
            if (isUserQuestion(legacy)) return legacy;
            const legacyStatus =
                typeof legacy.status === "string" && PRODUCTION_STATUSES.has(legacy.status)
                    ? legacy.status
                    : null;
            if (legacyStatus) {
                return {
                    ok: true,
                    format: "gcode",
                    files: [
                        {
                            side: input.side ?? null,
                            production_id: textField(legacy, "productionId", "production_id"),
                            status: legacyStatus,
                        },
                    ],
                };
            }
            return legacy;
        }
        case "generate_central_fab_stl": {
            const input = generateCentralFabStlInputSchema.parse(args);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            assertToolNotHeld(input.design_id);
            const sides = input.side ? [input.side] : (["left", "right"] as const);
            const files: Array<{ side: "left" | "right"; production_id: string | null; status: string }> = [];
            for (const side of sides) {
                try {
                    const result = await manufacturing.generateCentralFabStl({
                        designId: input.design_id,
                        side,
                    });
                    const status =
                        typeof result.status === "string" && PRODUCTION_STATUSES.has(result.status)
                            ? result.status
                            : null;
                    if (!status) throw new Error("Central-fab STL did not return a production status");
                    files.push({
                        side,
                        production_id: textField(result, "productionId", "production_id"),
                        status,
                    });
                } catch (error) {
                    if (sides.length > 1) {
                        throw new Error(
                            `Central-fab pair failed on the ${side} foot. No partial pair is returned. ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        );
                    }
                    throw error;
                }
            }
            if (files.length !== sides.length) {
                throw new Error("Central-fab pair did not produce both feet");
            }
            return { ok: true, format: "stl", files };
        }
        case "generate_cnc_gcode": {
            const input = generateCncGcodeInputSchema.parse(args);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            assertToolNotHeld(input.design_id);
            const result = await manufacturing.generateCncGcode({
                designId: input.design_id,
                ...(input.material ? { material: input.material } : {}),
                ...(input.mill_side === "RR" || input.mill_side === "LL"
                    ? { millSide: input.mill_side }
                    : {}),
            });
            const status =
                typeof result.status === "string" && PRODUCTION_STATUSES.has(result.status)
                    ? result.status
                    : null;
            if (!status) throw new Error("CNC G-code did not return a production status");
            const sideList = result.sides;
            const sides = Array.isArray(sideList)
                ? sideList.filter((side): side is "left" | "right" => side === "left" || side === "right")
                : [];
            const fileExtension = result.fileExtension === ".gcode" ? ".gcode" : null;
            if (!fileExtension) throw new Error("CNC G-code did not return the .gcode extension");
            return {
                ok: true,
                format: "gcode",
                file_extension: fileExtension,
                sides,
                files: [
                    {
                        production_id: textField(result, "productionId", "production_id"),
                        status,
                        sides,
                    },
                ],
            };
        }
        case "get_production": {
            const input = getProductionInputSchema.parse(args);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            return getProductionWithOptionalWait(manufacturing, input.production_id, input.wait_s ?? 0);
        }
        case "list_productions_by_design": {
            const input = listProductionsByDesignInputSchema.parse(args);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            const listed = await manufacturing.listProductionsByDesign({
                designId: input.design_id,
                side: input.side,
                presetId: input.preset_id,
            });
            const rows = Array.isArray(listed)
                ? listed
                : Array.isArray((listed as { productions?: unknown }).productions)
                  ? (listed as { productions: unknown[] }).productions
                  : [];
            return {
                productions: rows
                    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
                    .map((row) => publicProductionFromResult(row)),
            };
        }
        case "get_export_download": {
            const input = getExportDownloadInputSchema.parse(args);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            return manufacturing.getGcodeDownloadUrl(input.production_id);
        }
        case "build_design_exported_payload": {
            const input = buildDesignExportedPayloadInputSchema.parse(args);
            return buildDesignExportedPayload(input);
        }
        case "persist_saved_design_snapshot": {
            const input = persistSavedDesignSnapshotInputSchema.parse(args);
            assertToolNotHeld(input.design_id);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            try {
                return await manufacturing.persistSavedDesignSnapshot({
                    designId: input.design_id,
                    catalog: input.catalog,
                    ...(input.manufacturing_method
                        ? { manufacturingMethod: input.manufacturing_method }
                        : {}),
                });
            } catch (error) {
                const question = questionFromMessage(error instanceof Error ? error.message : String(error));
                if (question) return question;
                throw error;
            }
        }
        case "create_saved_design": {
            const input = createSavedDesignInputSchema.parse(args);
            assertToolNotHeld(input.external_order_id);
            if (input.client_id) assertToolNotHeld(input.client_id);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            try {
                return await manufacturing.createSavedDesign({
                    externalOrderId: input.external_order_id,
                    clientId: input.client_id,
                    givenName: input.given_name,
                    familyName: input.family_name,
                    catalog: input.catalog,
                    ...(input.manufacturing_method
                        ? { manufacturingMethod: input.manufacturing_method }
                        : {}),
                });
            } catch (error) {
                const question = questionFromMessage(error instanceof Error ? error.message : String(error));
                if (question) return question;
                throw error;
            }
        }
        case "prepare_vo_attachment": {
            const input = prepareVoAttachmentInputSchema.parse(args);
            return buildVoAttachFilesHandoff(input);
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
