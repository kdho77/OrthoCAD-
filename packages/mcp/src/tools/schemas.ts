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

export const generateGcodeInputObjectSchema = z.object({
    design_id: z.string().uuid().optional(),
    side: sideSchema.optional(),
    preset_id: z.string().min(1),
    /** Required unless use_saved_design. The saved-design path does not accept an STL deliverable. */
    stl_storage_key: z.string().min(1).optional(),
    output_type: z.enum(["gcode", "stl"]).default("gcode"),
    belt_angle_deg: z.number().min(10).max(80).optional(),
    file_name: z.string().max(200).optional(),
    material: z.string().max(80).optional(),
    /** Server builds the canonical Export mesh and returns per-foot belt G-code only. */
    use_saved_design: z.boolean().optional(),
    /** Optional bottom engrave label for this export (same sanitize as Print/Export textMarking). */
    patient_name: z.string().max(200).optional(),
    /**
     * Material hardness for a saved-design pair. Omitted or unknown hardness
     * returns a question for the user and does not slice.
     */
    hardness: z.string().max(40).optional(),
});

export const generateGcodeInputSchema = generateGcodeInputObjectSchema.superRefine((value, ctx) => {
    if (value.use_saved_design) {
        if (!value.design_id) {
            ctx.addIssue({ code: "custom", message: "design_id is required", path: ["design_id"] });
        }
        if (value.output_type === "stl") {
            ctx.addIssue({
                code: "custom",
                message: "Saved-design manufacturing returns G-code only",
                path: ["output_type"],
            });
        }
        return;
    }
    if (!value.stl_storage_key) {
        ctx.addIssue({
            code: "custom",
            message: "stl_storage_key is required unless use_saved_design",
            path: ["stl_storage_key"],
        });
    }
});

export const getExportDownloadInputSchema = z.object({
    production_id: z.string().uuid(),
});

export const getProductionInputSchema = z.object({
    production_id: z.string().uuid(),
});

export const listProductionsByDesignInputSchema = z.object({
    design_id: z.string().uuid(),
    side: sideSchema.optional(),
    preset_id: z.string().min(1).optional(),
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

const shoeSystemSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "_") : value),
    z.enum(["US_M", "US_W", "EU"]),
);

const widthSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, "_") : value),
    z.enum(["narrow", "medium", "wide", "extra_narrow", "extra_wide"]),
);

const archSchema = z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(["low", "medium", "standard", "high"]),
);

const savedDesignSliderSchema = z
    .object({
        forefoot_posting_deg: z.number().finite().optional(),
        rearfoot_posting_deg: z.number().finite().optional(),
        medial_skive_mm: z.number().finite().optional(),
        lateral_skive_mm: z.number().finite().optional(),
        arch_ease_mm: z.number().finite().optional(),
        heel_cup_depth_mm: z.number().finite().optional(),
        heel_cup_height_mm: z.number().finite().optional(),
        heel_cup_width_mm: z.number().finite().optional(),
        forefoot_width_mm: z.number().finite().optional(),
        heel_lift_mm: z.number().finite().optional(),
        medial_flange_mm: z.number().finite().optional(),
        lateral_flange_mm: z.number().finite().optional(),
    })
    .strict();

const wedgeSchema = z
    .object({
        side: z.enum(["medial", "lateral"]),
        value: z.number().finite(),
        unit: z.enum(["mm", "deg"]),
        degree_mode: z.enum(["local", "station"]).optional(),
    })
    .strict();

/**
 * VertexOrders catalog. Keep keys aligned with vertex/shared/saved-design-catalog.ts.
 * rx_text, notes, rigidity, extra_soft, and hardness are accepted and not mapped.
 */
export const savedDesignCatalogSchema = z
    .object({
        shoe_size: z
            .object({
                system: shoeSystemSchema,
                size: z.number().finite().positive(),
                left: z.number().finite().positive().nullable().optional(),
                right: z.number().finite().positive().nullable().optional(),
            })
            .strict()
            .optional(),
        width: widthSchema.optional(),
        arch: archSchema.optional(),
        flexible_foot: z.boolean().optional(),
        elements: z
            .array(
                z
                    .object({
                        name: z.string().trim().min(1).max(80),
                        side: z.enum(["left", "right"]),
                        height_mm: z.number().finite().nonnegative().optional(),
                    })
                    .strict(),
            )
            .max(24)
            .optional(),
        sliders: savedDesignSliderSchema.optional(),
        sliders_by_side: z
            .object({
                left: savedDesignSliderSchema.optional(),
                right: savedDesignSliderSchema.optional(),
            })
            .strict()
            .optional(),
        rearfoot_wedge: wedgeSchema.optional(),
        forefoot_wedge: wedgeSchema.optional(),
        full_length_wedge: z
            .object({
                side: z.enum(["medial", "lateral"]),
                value: z.number().finite(),
                unit: z.enum(["mm", "deg"]),
            })
            .strict()
            .optional(),
        rx_text: z.string().max(8000).optional(),
        notes: z.string().max(8000).optional(),
        rigidity: z.string().max(80).optional(),
        extra_soft: z.union([z.string().max(80), z.boolean()]).optional(),
        hardness: z.string().max(80).optional(),
    })
    .strict();

export const createSavedDesignInputSchema = z
    .object({
        external_order_id: z.string().trim().min(1).max(200),
        /**
         * Optional confirmation of the client already stored on this order.
         * It is not proof of the order's person and cannot create a client.
         */
        client_id: z.string().uuid().optional(),
        catalog: savedDesignCatalogSchema.optional(),
        /** Accepted and ignored. A name is not order-person identity. */
        patient_name: z.string().max(200).optional(),
        /** Chart label for a new client after the server verifier. Not sent to VertexOrders. */
        given_name: z.string().trim().min(1).max(100).optional(),
        /** Chart label for a new client after the server verifier. Not sent to VertexOrders. */
        family_name: z.string().trim().min(1).max(100).optional(),
    })
    .strict();

const attachFileSchema = z
    .object({
        side: sideSchema,
        /** CAD provenance only. Not copied into the VO file object. */
        storage_key: z.string().trim().min(1).max(500).optional(),
        filename: z.string().max(200).optional(),
        content_base64: z.string().min(1).optional(),
        download_url: z.string().min(1).max(4000).optional(),
        expires_at: z.string().min(1).max(80).optional(),
    })
    .strict();

export const prepareVoAttachmentInputSchema = z
    .object({
        /** Existing VO order UUID. Sent as orderId and external_order_id. */
        order_id: z.string().uuid(),
        /** CAD provenance only. Not sent; VO would check the design link. */
        design_id: z.string().uuid().optional(),
        files: z.array(attachFileSchema).min(1).max(2),
    })
    .strict();

export const persistSavedDesignSnapshotInputSchema = z
    .object({
        design_id: z.string().uuid(),
        catalog: savedDesignCatalogSchema.optional(),
        /** Accepted and dropped. Clinical values are not read from free text. */
        rx_text: z.string().max(8000).optional(),
        notes: z.string().max(8000).optional(),
    })
    .strict();

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
            "Belt G-code. Saved-design mode (use_saved_design) returns a production_id and status (pending, running, succeeded, or failed) per foot within a few seconds. " +
            "The server lofts and slices after that response. Poll get_production. Download with get_export_download only after succeeded. " +
            "A repeat call reuses an in-flight or succeeded production for the same design, foot, and preset. " +
            "No STL deliverable and no G-code bytes. Omitting side enqueues both feet. " +
            "Legacy mode still calls manufacturing.generateSolid → Python /manufacture with stl_storage_key. " +
            "PR #263 merged (70e33f8a): Apex + VertexSlice profiles. Leader v3 is a 20 mm block with a 1 mm neck.",
        inputSchema: generateGcodeInputObjectSchema,
    },
    {
        name: "get_production",
        description:
            "CAD-operator production status by production_id. Returns id, design, side, preset, status, timestamps, " +
            "G-code storage key, a non-PHI error, and a get_export_download hint when succeeded. No G-code bytes and no PHI.",
        inputSchema: getProductionInputSchema,
    },
    {
        name: "list_productions_by_design",
        description:
            "CAD-operator productions for a design_id. Optional side and preset_id filters. Same fields as get_production. " +
            "No G-code bytes and no PHI.",
        inputSchema: listProductionsByDesignInputSchema,
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
    {
        name: "persist_saved_design_snapshot",
        description:
            "Update one existing design's settingsJson in place with a loftable SAMPLE_Top parameter snapshot " +
            "for use_saved_design. Requires design_id. Copies stored integration-link shoe size and width when " +
            "present. Optional catalog keys (VertexOrders): shoe_size.system (US_M|US_W|EU), shoe_size.size, " +
            "shoe_size.left, shoe_size.right, width (narrow|medium|wide|extra_narrow|extra_wide), " +
            "arch (low|medium|standard|high → −3.5|0|0|+3 mm), flexible_foot (true → apex +4 mm on both feet), " +
            "elements.name, elements.side (left|right), elements.height_mm (omit for the built-in magnitude), " +
            "sliders.forefoot_posting_deg, sliders.rearfoot_posting_deg, sliders.medial_skive_mm, " +
            "sliders.lateral_skive_mm, sliders.arch_ease_mm, sliders.heel_cup_depth_mm, sliders.heel_cup_height_mm, " +
            "sliders.heel_cup_width_mm, sliders.forefoot_width_mm, sliders.heel_lift_mm, sliders.medial_flange_mm, " +
            "sliders.lateral_flange_mm, sliders_by_side.left, sliders_by_side.right (same slider keys), " +
            "rearfoot_wedge.side, rearfoot_wedge.value, rearfoot_wedge.unit, rearfoot_wedge.degree_mode, " +
            "forefoot_wedge.side, forefoot_wedge.value, forefoot_wedge.unit, forefoot_wedge.degree_mode, " +
            "full_length_wedge.side, full_length_wedge.value, full_length_wedge.unit. " +
            "Ignored and never mapped: rx_text, notes, rigidity, extra_soft. " +
            "hardness is stored only when it is Extra Soft, Soft, Medium, Hard, or Extra Hard; anything else is a question, not a guess. " +
            "Absent width is Medium and recorded as defaulted, not prescribed. " +
            "422 when shoe size is missing, EU cannot be mapped, supplied size or width disagrees with the stored link, " +
            "or a catalog field is unrecognized. Does not write File Ready, In Production, STL, or scan geometry.",
        inputSchema: persistSavedDesignSnapshotInputSchema,
    },
    {
        name: "create_saved_design",
        description:
            "Refresh the dogfood SAMPLE_Top design already bound to an existing VertexOrders order. " +
            "Source is vo2 and the tenant is the internal dogfood tenant. Does not take a clinic tenant id. " +
            "client_id is optional and only confirms the client already stored on that order. " +
            "patient_name, an external client id, and a name are not accepted as identity. " +
            "given_name and family_name are chart labels for a new client after the server verifier and are not sent as order-owner proof. " +
            "A different client_id, more than one link, or a client outside the dogfood tenant fails closed with no write and no tenant change. " +
            "When the order-owner verifier is unconfigured or refuses, this does not create a client or a design and does not call integration client upsert. " +
            "A server verifier may bind the verified person for this dogfood order. Caller fields are not that verifier. " +
            "CAD-operator scopes cannot assert the order's person. " +
            "A bound refresh uses the saved-design snapshot rules. No scan upload and no STL. " +
            "Medium width is used only when width is absent and is recorded as defaulted, not prescribed. " +
            "Missing shoe size or an unknown hardness returns a question for the user and does not guess.",
        inputSchema: createSavedDesignInputSchema,
    },
    {
        name: "prepare_vo_attachment",
        description:
            "Build the live VertexOrders attach_files arguments for an existing order UUID. " +
            "Forward only vo_attach_files (orderId, external_order_id, source vo2, files). " +
            "Each file is separate left or right G-code with exactly one of content_base64 or an https download_url of at most 200 characters. " +
            "A storage key is CAD provenance, not a VO field. design_id and tenant_id are omitted so VO does not run clinic or link checks. " +
            "Does not call VertexOrders and does not write an order status. " +
            "VO's public tool has no idempotency argument, so a repeat call is not server-side deduplication. STL is refused.",
        inputSchema: prepareVoAttachmentInputSchema,
    },
] as const;

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    const objectSchema = schema instanceof z.ZodEffects ? (schema._def.schema as z.ZodTypeAny) : schema;
    if (objectSchema instanceof z.ZodObject) {
        const shape = objectSchema.shape;
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

function unwrapZod(field: z.ZodTypeAny): z.ZodTypeAny {
    if (field instanceof z.ZodEffects) return unwrapZod(field._def.schema as z.ZodTypeAny);
    if (field instanceof z.ZodOptional) return unwrapZod(field._def.innerType as z.ZodTypeAny);
    if (field instanceof z.ZodNullable) return unwrapZod(field._def.innerType as z.ZodTypeAny);
    if (field instanceof z.ZodDefault) return unwrapZod(field._def.innerType as z.ZodTypeAny);
    return field;
}

export function listMcpSavedDesignCatalogKeyPaths(): string[] {
    const paths: string[] = [];
    const walk = (field: z.ZodTypeAny, prefix: string) => {
        const inner = unwrapZod(field);
        if (inner instanceof z.ZodObject) {
            for (const [key, value] of Object.entries(inner.shape)) {
                const path = prefix ? `${prefix}.${key}` : key;
                paths.push(path);
                walk(value as z.ZodTypeAny, path);
            }
            return;
        }
        if (inner instanceof z.ZodArray) walk(inner._def.type as z.ZodTypeAny, prefix);
    };
    walk(savedDesignCatalogSchema, "");
    return paths;
}

function zodFieldToJson(field: z.ZodTypeAny): Record<string, unknown> {
    const inner = unwrapZod(field);
    if (inner instanceof z.ZodString) {
        const out: Record<string, unknown> = { type: "string" };
        if (inner._def.checks?.some((c) => c.kind === "uuid")) out.format = "uuid";
        return out;
    }
    if (inner instanceof z.ZodNumber) return { type: "number" };
    if (inner instanceof z.ZodBoolean) return { type: "boolean" };
    if (inner instanceof z.ZodEnum) return { type: "string", enum: inner._def.values };
    if (inner instanceof z.ZodLiteral) return { type: "string", enum: [inner.value] };
    if (inner instanceof z.ZodUnion) {
        return { anyOf: (inner._def.options as z.ZodTypeAny[]).map((option) => zodFieldToJson(option)) };
    }
    if (inner instanceof z.ZodArray) {
        return { type: "array", items: zodFieldToJson(inner._def.type as z.ZodTypeAny) };
    }
    if (inner instanceof z.ZodObject) return zodToJsonSchema(inner);
    return {};
}
