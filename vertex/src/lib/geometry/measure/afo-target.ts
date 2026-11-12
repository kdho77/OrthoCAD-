// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Mesh the AFO measurement tools read.
 * Shell wins. Before a shell exists, the cast or corrected positive is used.
 * The raw scan is not a print mesh.
 */
export function afoMeasureTarget<T>(meshes: {
    shell: T | null | undefined;
    corrected: T | null | undefined;
    cast: T | null | undefined;
}): T | null {
    return meshes.shell ?? meshes.corrected ?? meshes.cast ?? null;
}

/** Registry id of the mesh measurements pick and reproject. Never the raw scan. */
export type AfoMeasureSolidId = "afo-shell" | "afo-corrected" | "afo-cast";

export function afoMeasureSolidId(meshes: {
    shell: unknown;
    corrected: unknown;
    cast: unknown;
}): AfoMeasureSolidId | null {
    if (meshes.shell) return "afo-shell";
    if (meshes.corrected) return "afo-corrected";
    if (meshes.cast) return "afo-cast";
    return null;
}
