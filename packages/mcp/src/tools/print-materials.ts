/**
 * Canonical insole print materials advertised by list_materials.
 * Keep this object identical to CANONICAL_INSOLE_PRINT_MATERIALS in
 * vertex/server/src/lib/vertexslice-client.ts. The server resolves the same
 * aliases before VertexSlice. ApexVylon is not an insole material.
 * "ApexLight Foam" is the VertexOrders label for Apex Light.
 */

export const LOCKED_INSOLE_PRESET_ID = "apex-v2-insole-95a";

export const CANONICAL_INSOLE_PRINT_MATERIALS = {
    locked_preset_id: LOCKED_INSOLE_PRESET_ID,
    default_material: "apex_core",
    materials: [
        {
            id: "ApexLight",
            label: "Apex Light",
            vertex_slice_material: "apex_light",
            enabled: true,
            locked_preset_id: LOCKED_INSOLE_PRESET_ID,
            aliases: ["ApexLight", "Apex Light", "apex_light", "ApexLight Foam"],
        },
        {
            id: "ApexCore",
            label: "Apex Core",
            vertex_slice_material: "apex_core",
            enabled: true,
            locked_preset_id: LOCKED_INSOLE_PRESET_ID,
            aliases: ["ApexCore", "Apex Core", "apex_core", "ApexComfort", "Apex Comfort"],
        },
        {
            id: "ApexBounce",
            label: "Apex Bounce",
            vertex_slice_material: "apex_bounce",
            enabled: true,
            locked_preset_id: LOCKED_INSOLE_PRESET_ID,
            aliases: ["ApexBounce", "Apex Bounce", "apex_bounce"],
        },
        {
            id: "ApexForge",
            label: "Apex Forge",
            vertex_slice_material: "apex_forge",
            enabled: true,
            locked_preset_id: LOCKED_INSOLE_PRESET_ID,
            aliases: ["ApexForge", "Apex Forge", "apex_forge"],
        },
    ],
} as const;

export type CanonicalInsolePrintMaterials = typeof CANONICAL_INSOLE_PRINT_MATERIALS;

export function canonicalInsolePrintMaterialCatalog(): CanonicalInsolePrintMaterials {
    return CANONICAL_INSOLE_PRINT_MATERIALS;
}

function compactMaterialKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

const SLICE_ID_BY_COMPACT_KEY = new Map<string, string>();
for (const material of CANONICAL_INSOLE_PRINT_MATERIALS.materials) {
    for (const key of [material.id, material.label, material.vertex_slice_material, ...material.aliases]) {
        const compact = compactMaterialKey(key);
        if (compact) SLICE_ID_BY_COMPACT_KEY.set(compact, material.vertex_slice_material);
    }
}

/**
 * Validate a generate_gcode material. Returns the trimmed caller string so the
 * server can normalize aliases. Omitted material stays omitted (server default
 * apex_core). Unknown names throw. Nothing is substituted.
 */
export function callerPrintMaterial(material: string | undefined): string | undefined {
    const raw = material?.trim() ?? "";
    if (!raw) return undefined;
    const id = SLICE_ID_BY_COMPACT_KEY.get(compactMaterialKey(raw));
    if (!id) {
        throw new Error(
            `Unknown print material "${raw}". Use apex_core, apex_light, apex_bounce, or apex_forge. Nothing was substituted.`,
        );
    }
    return raw;
}

/** Omitted preset stays omitted (server uses the locked id). Any other id is rejected. */
export function callerPrintPreset(presetId: string | undefined): string | undefined {
    const raw = presetId?.trim() ?? "";
    if (!raw) return undefined;
    if (raw !== LOCKED_INSOLE_PRESET_ID) {
        throw new Error(
            `Printer G-code requires locked profile ${LOCKED_INSOLE_PRESET_ID}. preset_id "${raw}" was rejected and was not substituted.`,
        );
    }
    return raw;
}
