// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Type stub for the generated Node ESM bundle. The .js file is emitted by
// scripts/bundle-canonical-export-loft.mjs and is not source.

export function buildFinalizedFootFromSavedSettings(input: {
    settingsJson: unknown;
    side: "left" | "right";
    sampleTopBytes: ArrayBuffer;
    includeLeader?: boolean;
    fontBytes?: ArrayBuffer;
    elementsBaseDir?: string;
}): Promise<{
    side: "left" | "right";
    stl: ArrayBuffer;
    solidTriangles: number;
    uploadTriangles: number;
    fingerprint: string;
}>;

export function buildRegional3mfFromSavedSettings(input: {
    settingsJson: unknown;
    side: "left" | "right";
    manufacturingStl: ArrayBuffer;
}): Promise<{ bytes: Uint8Array; regionCount: number } | null>;
