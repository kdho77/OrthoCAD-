// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { sha256Hex } from "@/lib/geometry/procedural-wall/sha256";
import { hasActiveTextMarking, TEXT_FONT_ID } from "./constants";
import type { TextMarking } from "./types";

/**
 * Design-state contribution for Print text. Empty / missing text is `""` so
 * frozen STL hashes stay byte-identical to designs without a text field.
 */
export function textMarkingHash(marking: TextMarking | null | undefined): string {
    if (!hasActiveTextMarking(marking) || !marking) return "";
    return sha256Hex(
        [
            marking.text,
            TEXT_FONT_ID,
            marking.capHeightMm.toFixed(3),
            marking.depthMm.toFixed(3),
            marking.mode,
            marking.surface,
            marking.placementU.toFixed(4),
            marking.rotationDeg.toFixed(2),
            marking.letterSpacingMm.toFixed(3),
            marking.bold ? "1" : "0",
            marking.heightMm.toFixed(3),
            marking.anchor ?? "arch",
            marking.feet ?? "both",
            marking.differentOnLR ? "1" : "0",
            marking.textLeft ?? "",
            marking.textRight ?? "",
            (marking.nudgeAlongMm ?? 0).toFixed(2),
            (marking.nudgeAcrossMm ?? 0).toFixed(2),
        ].join("|"),
    );
}
