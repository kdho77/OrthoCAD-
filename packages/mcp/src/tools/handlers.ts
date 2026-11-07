import type { IntegrationClient } from "../clients/integration-client.js";
import { IntegrationHttpError } from "../clients/integration-client.js";
import type { ManufacturingClient } from "../clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../config.js";
import { requireCadOperatorKey } from "../config.js";
import { buildDesignExportedPayload } from "../payload/design-exported-payload.js";
import { buildVoAttachFilesHandoff, DOGFOOD_HELD_ID_PREFIXES } from "../payload/vo-attach-files.js";
import {
    buildDesignExportedPayloadInputSchema,
    createSavedDesignInputSchema,
    generateGcodeInputSchema,
    getDesignInputSchema,
    getDesignParamsInputSchema,
    getExportDownloadInputSchema,
    listDesignsByOrderInputSchema,
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

function gcodeFileFromResult(side: "left" | "right", result: Record<string, unknown>): SavedDesignGcodeFile {
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
        case "generate_gcode": {
            const input = generateGcodeInputSchema.parse(args);
            const manufacturing =
                deps.manufacturing ??
                (await import("../clients/manufacturing-client.js")).createManufacturingClient({
                    trpcUrl: deps.config.trpcUrl,
                    cadOperatorKey: requireCadOperatorKey(deps.config),
                });
            if (input.use_saved_design) {
                if (!input.design_id) throw new Error("design_id is required");
                assertToolNotHeld(input.design_id);
                if (input.output_type === "stl") {
                    throw new Error("Saved-design manufacturing returns G-code only");
                }
                const sides = input.side ? [input.side] : (["left", "right"] as const);
                const files: SavedDesignGcodeFile[] = [];
                for (const side of sides) {
                    try {
                        const result = await manufacturing.generateFromSavedDesign({
                            designId: input.design_id,
                            side,
                            presetId: input.preset_id,
                            fileName: input.file_name ? `${side}-${input.file_name}` : `${side}.gcode`,
                            patientName: input.patient_name,
                            hardness: input.hardness,
                        });
                        if (isUserQuestion(result)) {
                            if (files.length > 0) {
                                throw new Error(
                                    `Belt pair failed on the ${side} foot. No partial pair is returned.`,
                                );
                            }
                            return result;
                        }
                        files.push(gcodeFileFromResult(side, result));
                    } catch (error) {
                        if (sides.length > 1) {
                            throw new Error(
                                `Belt pair failed on the ${side} foot. No partial pair is returned. ${
                                    error instanceof Error ? error.message : String(error)
                                }`,
                            );
                        }
                        throw error;
                    }
                }
                if (files.length !== sides.length) {
                    throw new Error("Belt pair did not produce both feet");
                }
                return { ok: true, format: "gcode", files };
            }
            if (!input.stl_storage_key) {
                throw new Error("stl_storage_key is required unless use_saved_design");
            }
            return manufacturing.generateGcode({
                designId: input.design_id,
                side: input.side,
                presetId: input.preset_id,
                stlStorageKey: input.stl_storage_key,
                outputType: input.output_type,
                beltAngleDeg: input.belt_angle_deg,
                fileName: input.file_name,
                material: input.material,
                patientName: input.patient_name,
            });
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
                    catalog: input.catalog,
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
