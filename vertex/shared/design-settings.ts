// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Parameter snapshot stored on designs.settingsJson. Meshes are not part of this.

export const DESIGN_SETTINGS_SCHEMA_VERSION = 1;

export interface DesignSettingsEnvelope {
    schemaVersion: number;
    settings: Record<string, unknown>;
}

/** Keys that would persist a mesh or machine toolpath. Settings never include these. */
const MESH_BLOB_KEYS = new Set([
    "vertices",
    "faces",
    "indices",
    "mesh",
    "meshes",
    "geometry",
    "stl",
    "gcode",
    "triangles",
]);

export function stripMeshBlobs<T>(value: T): T {
    if (Array.isArray(value)) return value.map((entry) => stripMeshBlobs(entry)) as T;
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
        if (MESH_BLOB_KEYS.has(key)) continue;
        out[key] = stripMeshBlobs(source[key]);
    }
    return out as T;
}

export function designSettingsEnvelope(settings: Record<string, unknown>): DesignSettingsEnvelope {
    return {
        schemaVersion: DESIGN_SETTINGS_SCHEMA_VERSION,
        settings: stripMeshBlobs(settings),
    };
}

/** Version 1 snapshot, or null when the row should fall back to relational columns. */
export function readStoredDesignSettings(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const envelope = raw as { schemaVersion?: unknown; settings?: unknown };
    if (envelope.schemaVersion !== DESIGN_SETTINGS_SCHEMA_VERSION) return null;
    const settings = envelope.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
    return settings as Record<string, unknown>;
}
