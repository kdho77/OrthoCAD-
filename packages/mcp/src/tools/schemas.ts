import { z } from "zod";

export const integrationSourceSchema = z.enum(["vo2", "orthocloud"]);
export const sideSchema = z.enum(["left", "right"]);

export const getDesignInputSchema = z.object({
    design_id: z.string().uuid(),
});

export const listDesignsByOrderInputSchema = z.object({
    external_order_id: z.string().trim().min(1).max(200),
    tenant_id: z.string().uuid(),
    source: integrationSourceSchema,
});

export const getDesignParamsInputSchema = z.object({
    design_id: z.string().uuid(),
});

export const prepareManufacturingStlUploadInputSchema = z.object({
    side: sideSchema,
    file_name: z.string().max(200).optional(),
});

export const generateGcodeInputSchema = z.object({
    design_id: z.string().uuid().optional(),
    side: sideSchema.optional(),
    preset_id: z.string().min(1),
    stl_storage_key: z.string().min(1),
    output_type: z.enum(["gcode", "stl"]).default("gcode"),
    belt_angle_deg: z.number().min(10).max(80).optional(),
    file_name: z.string().max(200).optional(),
    material: z.string().max(80).optional(),
});

export const getExportDownloadInputSchema = z.object({
    production_id: z.string().uuid(),
});

const exportedFileSchema = z.object({
    side: z.string().min(1),
    machine: z.string().min(1),
    format: z.string().min(1),
    material: z.string().min(1),
    download_url: z.string().url(),
});

export const buildDesignExportedPayloadInputSchema = z.object({
    id: z.string().min(1),
    design_id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    source: integrationSourceSchema,
    external_order_id: z.string().trim().min(1).max(200),
    files: z.array(exportedFileSchema).min(1),
});

/** MCP tool catalog metadata (Phase A v0). */
export const MCP_TOOL_DEFINITIONS = [
    {
        name: "get_design",
        description:
            "Fetch an integration design record by design_id (integration REST GET; Phase B server route).",
        inputSchema: getDesignInputSchema,
    },
    {
        name: "list_designs_by_order",
        description: "List designs for an external order (integration REST GET; Phase B server route).",
        inputSchema: listDesignsByOrderInputSchema,
    },
    {
        name: "get_design_params",
        description:
            "Load design document / settingsJson for production (tRPC design.get; requires ORTHOCAD_MCP_TRPC_BEARER).",
        inputSchema: getDesignParamsInputSchema,
    },
    {
        name: "prepare_manufacturing_stl_upload",
        description:
            "Signed URL for uploading a finalized STL. CAD build is client-side — STL must already exist in OrthoCAD before upload.",
        inputSchema: prepareManufacturingStlUploadInputSchema,
    },
    {
        name: "generate_gcode",
        description:
            "Run manufacturing.generateSolid after STL is in storage (stl_storage_key). Does not build mesh from scan.",
        inputSchema: generateGcodeInputSchema,
    },
    {
        name: "get_export_download",
        description: "Signed download URL for stored G-code (manufacturing.getGcodeDownloadUrl).",
        inputSchema: getExportDownloadInputSchema,
    },
    {
        name: "build_design_exported_payload",
        description: "Build design.exported VO handoff JSON (files + ids only; no order status writes).",
        inputSchema: buildDesignExportedPayloadInputSchema,
    },
] as const;

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape;
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [key, value] of Object.entries(shape)) {
            properties[key] = zodFieldToJson(value as z.ZodTypeAny);
            if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
                required.push(key);
            }
        }
        return {
            type: "object",
            properties,
            ...(required.length ? { required } : {}),
        };
    }
    return { type: "object" };
}

function zodFieldToJson(field: z.ZodTypeAny): Record<string, unknown> {
    if (field instanceof z.ZodOptional) return zodFieldToJson(field._def.innerType as z.ZodTypeAny);
    if (field instanceof z.ZodDefault) return zodFieldToJson(field._def.innerType as z.ZodTypeAny);
    if (field instanceof z.ZodString) {
        const out: Record<string, unknown> = { type: "string" };
        if (field._def.checks?.some((c) => c.kind === "uuid")) out.format = "uuid";
        return out;
    }
    if (field instanceof z.ZodNumber) return { type: "number" };
    if (field instanceof z.ZodEnum) return { type: "string", enum: field._def.values };
    if (field instanceof z.ZodArray) {
        return { type: "array", items: zodFieldToJson(field._def.type as z.ZodTypeAny) };
    }
    return {};
}
