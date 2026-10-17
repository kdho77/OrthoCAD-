// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CLASS_PREVIEW_COLORS,
    HARDNESS_CLASS_TABLE,
    type RegionHardnessClass,
} from "../../../shared/print-recipe/hardness-class-table";

export interface SparseSegment {
    type: string;
    feedMmMin: number;
    speedMmS: number;
    className: RegionHardnessClass | "unknown";
    color: string;
}

export interface GcodeVerifyResult {
    ok: boolean;
    errors: string[];
    segments: SparseSegment[];
    classesSeen: RegionHardnessClass[];
    previewColors: Record<string, string>;
}

const SPEED_TO_CLASS: Array<{ speed: number; cls: Exclude<RegionHardnessClass, "Custom"> }> = [
    { speed: HARDNESS_CLASS_TABLE.Soft.sparseInfillSpeedMmS, cls: "Soft" },
    { speed: HARDNESS_CLASS_TABLE.Medium.sparseInfillSpeedMmS, cls: "Medium" },
    { speed: HARDNESS_CLASS_TABLE.Firm.sparseInfillSpeedMmS, cls: "Firm" },
    { speed: HARDNESS_CLASS_TABLE.Rigid.sparseInfillSpeedMmS, cls: "Rigid" },
];

function classFromSpeed(mmS: number): RegionHardnessClass | "unknown" {
    let best: RegionHardnessClass | "unknown" = "unknown";
    let bestD = 0.08;
    for (const row of SPEED_TO_CLASS) {
        const d = Math.abs(row.speed - mmS);
        if (d < bestD) {
            bestD = d;
            best = row.cls;
        }
    }
    return best;
}

const SPARSE_TYPES = /sparse infill|internal infill|infill/i;
const SOLID_TYPES = /solid infill|internal solid|top solid|bottom solid/i;

/**
 * Parse F (mm/min) on extrusion moves after each `;TYPE:` comment.
 * Maps fingerprint speeds to Soft/Medium/Firm/Rigid. Fails if a required class
 * has no sparse segments, or if Soft is mixed with unexpected solid infill.
 */
export function verifyGcodeByClass(
    gcode: string,
    requiredClasses: RegionHardnessClass[] = ["Soft", "Medium", "Firm", "Rigid"],
): GcodeVerifyResult {
    const errors: string[] = [];
    const segments: SparseSegment[] = [];
    const lines = gcode.split(/\r?\n/);
    let currentType = "";
    const feeds = new Map<string, number[]>();

    for (const line of lines) {
        const typeMatch = line.match(/^;TYPE:(.+)$/i) || line.match(/^;\s*TYPE:(.+)$/i);
        if (typeMatch) {
            currentType = typeMatch[1]!.trim();
            continue;
        }
        if (!currentType) continue;
        const fMatch = line.match(/\bF([0-9]+(?:\.[0-9]+)?)\b/);
        if (!fMatch) continue;
        if (!/^G1\b/i.test(line) || !/\bE/.test(line)) continue;
        const feedMmMin = Number(fMatch[1]);
        const speedMmS = feedMmMin / 60;
        const list = feeds.get(currentType) ?? [];
        list.push(speedMmS);
        feeds.set(currentType, list);

        if (SPARSE_TYPES.test(currentType) && !SOLID_TYPES.test(currentType)) {
            const className = classFromSpeed(speedMmS);
            segments.push({
                type: currentType,
                feedMmMin,
                speedMmS,
                className,
                color: className === "unknown" ? "#888888" : CLASS_PREVIEW_COLORS[className],
            });
        }
    }

    const classesSeen = [
        ...new Set(segments.map((s) => s.className).filter((c): c is RegionHardnessClass => c !== "unknown")),
    ];

    for (const cls of requiredClasses) {
        if (cls === "Custom") continue;
        if (!classesSeen.includes(cls)) {
            errors.push(`class ${cls} has no Sparse infill segments`);
        }
    }

    const softSpeeds = SPEED_TO_CLASS.find((s) => s.cls === "Soft")!.speed;
    for (const [type, speeds] of feeds) {
        if (!SOLID_TYPES.test(type)) continue;
        const mixed = speeds.some((s) => Math.abs(s - softSpeeds) < 0.08);
        if (mixed && requiredClasses.includes("Soft")) {
            errors.push(`unexpected solid infill in Soft (${type})`);
        }
    }

    const previewColors: Record<string, string> = {};
    for (const cls of classesSeen) previewColors[cls] = CLASS_PREVIEW_COLORS[cls];

    return { ok: errors.length === 0, errors, segments, classesSeen, previewColors };
}

export function colorizePreviewByClass(result: GcodeVerifyResult): string {
    const lines = [";ORTHOCAD_CLASS_PREVIEW"];
    for (const [cls, color] of Object.entries(result.previewColors)) {
        lines.push(`;CLASS ${cls} ${color}`);
    }
    return `${lines.join("\n")}\n`;
}
