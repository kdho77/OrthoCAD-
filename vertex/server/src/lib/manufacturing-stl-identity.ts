// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";

import {
    MANUFACTURING_STL_PLACEMENT_VERSION,
    STALE_PRE52_BELT_MANUFACTURING_STL,
} from "../../../shared/manufacturing-stl-identity.js";

export {
    isStalePre52ManufacturingEtag,
    MANUFACTURING_STL_PLACEMENT_VERSION,
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
 * Identity of one saved-design manufacturing STL. Composed text, belt frame,
 * and placement version. A checkpoint or temp from a different triple is not reused.
 */
export function manufacturingStlRunIdentity(input: {
    side: "left" | "right";
    composedText: string;
    beltPrint: boolean;
    placementVersion?: number;
}): string {
    return createHash("sha256")
        .update(
            stableStringify({
                placementVersion: input.placementVersion ?? MANUFACTURING_STL_PLACEMENT_VERSION,
                beltPrint: input.beltPrint === true,
                side: input.side,
                composedText: input.composedText,
            }),
        )
        .digest("hex");
}

/** Byte identity of the pre-#52 left archive. Size is checked before the md5. */
export function isStalePre52ManufacturingStlBytes(bytes: Uint8Array): boolean {
    if (bytes.byteLength !== STALE_PRE52_BELT_MANUFACTURING_STL.sizeBytes) return false;
    const md5 = createHash("md5").update(bytes).digest("hex");
    return md5 === STALE_PRE52_BELT_MANUFACTURING_STL.etag;
}
