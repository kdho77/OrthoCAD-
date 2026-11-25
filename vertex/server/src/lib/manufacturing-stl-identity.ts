// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";

import {
    manufacturingStlIdentityPayload,
    STALE_PRE52_BELT_MANUFACTURING_STL,
} from "../../../shared/manufacturing-stl-identity.js";

export {
    isStalePre52ManufacturingEtag,
    MANUFACTURING_STL_PLACEMENT_VERSION,
    manufacturingStlIdentityPayload,
    ORTHOCAD_MANUFACTURING_VERSION,
    STALE_PRE52_BELT_MANUFACTURING_STL,
} from "../../../shared/manufacturing-stl-identity.js";

function stableStringify(value: unknown): string {
    if (value === undefined) return "null";
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/**
 * Identity of one saved-design manufacturing STL. The hash is the full saved
 * design plus side, belt frame, placement version, and the OrthoCAD/slicer
 * version. A checkpoint or temp from any other design is not reused.
 */
export function manufacturingStlRunIdentity(input: {
    side: "left" | "right";
    savedDesign: unknown;
    beltPrint: boolean;
    placementVersion?: number;
    orthocadVersion?: string;
    slicerVersion?: string;
}): string {
    return createHash("sha256")
        .update(stableStringify(manufacturingStlIdentityPayload(input)))
        .digest("hex");
}

/** Byte identity of the pre-#52 left archive. Size is checked before the md5. */
export function isStalePre52ManufacturingStlBytes(bytes: Uint8Array): boolean {
    if (bytes.byteLength !== STALE_PRE52_BELT_MANUFACTURING_STL.sizeBytes) return false;
    const md5 = createHash("md5").update(bytes).digest("hex");
    return md5 === STALE_PRE52_BELT_MANUFACTURING_STL.etag;
}
