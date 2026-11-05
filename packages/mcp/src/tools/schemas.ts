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

const voHandoffFileSchema = z.object({
    side: z.string().min(1),
    machine: z.string().min(1),
    format: z.string().min(1),
    material: z.string().min(1),
    download_url: z.string().url(),
    expires_at: z.string().min(1),
    content_type: z.string().min(1),
    filename: z.string().min(1),
});

export const buildDesignExportedPayloadInputSchema = z.object({
    design_id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    source: z.literal("vo2"),
    external_order_id: z.string().trim().min(1).max(200),
    files: z.array(voHandoffFileSchema).min(1),
});

/** MCP tool catalog metadata (Phase A v0). */
export const MCP_TOOL_DEFINITIONS = [
    {
        name: "get_design",
        description:
            "Fetch a design by design_id. Auth: CAD-operator Bearer key. Integration GET route is Phase B residual.",
        inputSchema: getDesignInputSchema,
    },
    {
        name: "list_designs_by_order",
        description:
            "List designs for external_order_id + tenant_id + source. Auth: CAD-operator key. GET route Phase B.",
        inputSchema: listDesignsByOrderInputSchema,
    },
    {
        name: "get_design_params",
        description:
            "Design document / settingsJson for production via documented manufacturing tRPC wrap. Auth: CAD-operator key only.",
        inputSchema: getDesignParamsInputSchema,
    },
    {
        name: "prepare_manufacturing_stl_upload",
        description:
            "Signed URL to upload finalized STL (CAD build is client-side in OrthoCAD). Auth: CAD-operator key.",
        inputSchema: prepareManufacturingStlUploadInputSchema,
    },
    {
        name: "generate_gcode",
        description:
            "Production G-code on **main today**: tRPC manufacturing.generateSolid → Python /manufacture. Requires stl_storage_key. " +
            "Main path: manufacturing.generateSolid → Python /manufacture. PR #263 merged (70e33f8a): Apex + VertexSlice profiles + leader v2 on main; Phase A uses this wrap only.",
        inputSchema: generateGcodeInputSchema,
    },
    {
        name: "get_export_download",
        description:
            "Signed G-code download URL (manufacturing.getGcodeDownloadUrl). Auth: CAD-operator key.",
        inputSchema: getExportDownloadInputSchema,
    },
    {
        name: "build_design_exported_payload",
        description:
            "VO upload handoff JSON: design_id, external_order_id, tenant_id, source vo2, files[] with download metadata. " +
            "Does not write VO order status.",
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
    if (field instanceof z.ZodLiteral) return { type: "string", enum: [field.value] };
    if (field instanceof z.ZodArray) {
        return { type: "array", items: zodFieldToJson(field._def.type as z.ZodTypeAny) };
    }
    return {};
}
