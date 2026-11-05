import type { IntegrationClient } from "../clients/integration-client.js";
import { IntegrationHttpError } from "../clients/integration-client.js";
import type { ManufacturingClient } from "../clients/manufacturing-client.js";
import type { OrthocadMcpConfig } from "../config.js";
import { requireCadOperatorKey } from "../config.js";
import { buildDesignExportedPayload } from "../payload/design-exported-payload.js";
import {
    buildDesignExportedPayloadInputSchema,
    generateGcodeInputSchema,
    getDesignInputSchema,
    getDesignParamsInputSchema,
    getExportDownloadInputSchema,
    listDesignsByOrderInputSchema,
    prepareManufacturingStlUploadInputSchema,
} from "./schemas.js";

export interface OrthocadToolDeps {
    config: OrthocadMcpConfig;
    integration?: IntegrationClient;
    manufacturing?: ManufacturingClient;
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
            return manufacturing.generateGcode({
                designId: input.design_id,
                side: input.side,
                presetId: input.preset_id,
                stlStorageKey: input.stl_storage_key,
                outputType: input.output_type,
                beltAngleDeg: input.belt_angle_deg,
                fileName: input.file_name,
                material: input.material,
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
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
