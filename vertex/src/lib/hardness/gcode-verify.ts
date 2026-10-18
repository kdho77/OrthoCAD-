// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CLASS_PREVIEW_COLORS,
    classFingerprint,
    classLineWidthMm,
    HARDNESS_CLASS_TABLE,
    NAMED_HARDNESS_CLASSES,
    type NamedHardnessClass,
    type RegionHardnessClass,
} from "../../../shared/print-recipe/hardness-class-table";

export interface SparseSegment {
    type: string;
    feedMmMin: number;
    speedMmS: number;
    lineWidthMm: number;
    densityPct?: number;
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

function classFromFingerprint(
    mmS: number,
    lineWidthMm?: number,
    densityPct?: number,
): RegionHardnessClass | "unknown" {
    const hits: NamedHardnessClass[] = [];
    for (const cls of NAMED_HARDNESS_CLASSES) {
        const row = HARDNESS_CLASS_TABLE[cls];
        if (Math.abs(row.sparseInfillSpeedMmS - mmS) >= 0.08) continue;
        if (lineWidthMm !== undefined && Math.abs(row.sparseInfillLineWidthMm - lineWidthMm) > 0.05) {
            continue;
        }
        if (densityPct !== undefined && Math.abs(row.sparseInfillDensityPct - densityPct) > 0.5) {
            continue;
        }
        hits.push(cls);
    }
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1 && densityPct !== undefined) {
        const byDensity = hits.find(
            (cls) => Math.abs(HARDNESS_CLASS_TABLE[cls].sparseInfillDensityPct - densityPct) <= 0.5,
        );
        if (byDensity) return byDensity;
    }
    return "unknown";
}

const SPARSE_TYPES = /sparse infill|internal infill|infill/i;
const SOLID_TYPES = /solid infill|internal solid|top solid|bottom solid/i;

/**
 * Parse F (mm/min) on extrusion moves after each `;TYPE:` comment.
 * Maps fingerprint speed + line width + density to Extra Soft → Extra Hard
 * (Hard and Extra Hard share 23 mm/s; density splits them) and checks each
 * class's sparse_infill_line_width against the single hardness table.
 */
export function verifyGcodeByClass(
    gcode: string,
    requiredClasses: RegionHardnessClass[] = [...NAMED_HARDNESS_CLASSES],
): GcodeVerifyResult {
    const errors: string[] = [];
    const segments: SparseSegment[] = [];
    const lines = gcode.split(/\r?\n/);
    let currentType = "";
    let commentLineWidth: number | undefined;
    let commentDensityPct: number | undefined;
    const feeds = new Map<string, number[]>();

    for (const line of lines) {
        const lw = line.match(/^;\s*(?:LINE_WIDTH|sparse_infill_line_width)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
        if (lw) {
            commentLineWidth = Number(lw[1]);
            continue;
        }
        const dens = line.match(
            /^;\s*(?:INFILL_DENSITY|sparse_infill_density)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)%?/i,
        );
        if (dens) {
            commentDensityPct = Number(dens[1]);
            continue;
        }
        const typeMatch = line.match(/^;TYPE:(.+)$/i) || line.match(/^;\s*TYPE:(.+)$/i);
        if (typeMatch) {
            currentType = typeMatch[1]?.trim() ?? "";
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
            const className = classFromFingerprint(speedMmS, commentLineWidth, commentDensityPct);
            const lineWidthMm = className === "unknown" ? Number.NaN : classLineWidthMm(className);
            if (className !== "unknown" && commentLineWidth !== undefined) {
                if (Math.abs(commentLineWidth - lineWidthMm) > 0.05) {
                    errors.push(
                        `class ${className} line width ${commentLineWidth} mm ≠ table ${lineWidthMm} mm`,
                    );
                }
            }
            segments.push({
                type: currentType,
                feedMmMin,
                speedMmS,
                lineWidthMm,
                densityPct: commentDensityPct,
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

    for (const cls of classesSeen) {
        if (cls === "Custom") continue;
        const fp = classFingerprint(cls);
        if (fp.lineWidthMm !== classLineWidthMm(cls)) {
            errors.push(`class ${cls} fingerprint line width mismatch`);
        }
        if (fp.pattern !== "gyroid") {
            errors.push(`class ${cls} fingerprint pattern ${fp.pattern} ≠ gyroid`);
        }
        if (fp.infillWallOverlapPct !== 25) {
            errors.push(`class ${cls} fingerprint overlap ${fp.infillWallOverlapPct}% ≠ 25%`);
        }
        const expected = classLineWidthMm(cls);
        if (Math.abs(fp.lineWidthMm - expected) > 1e-6) {
            errors.push(`class ${cls} line width ${fp.lineWidthMm} mm ≠ ${expected} mm`);
        }
        if (fp.speedMmS !== HARDNESS_CLASS_TABLE[cls].sparseInfillSpeedMmS) {
            errors.push(`class ${cls} fingerprint speed ${fp.speedMmS} ≠ table`);
        }
        if (fp.densityPct !== HARDNESS_CLASS_TABLE[cls].sparseInfillDensityPct) {
            errors.push(`class ${cls} fingerprint density ${fp.densityPct} ≠ table`);
        }
    }

    const extraSoftSpeeds = HARDNESS_CLASS_TABLE["Extra Soft"].sparseInfillSpeedMmS;
    const softSpeeds = HARDNESS_CLASS_TABLE.Soft.sparseInfillSpeedMmS;
    for (const [type, speeds] of feeds) {
        if (!SOLID_TYPES.test(type)) continue;
        const mixed = speeds.some(
            (s) => Math.abs(s - extraSoftSpeeds) < 0.08 || Math.abs(s - softSpeeds) < 0.08,
        );
        if (mixed && (requiredClasses.includes("Soft") || requiredClasses.includes("Extra Soft"))) {
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
        const lw = cls === "unknown" ? "" : ` lw=${classLineWidthMm(cls as RegionHardnessClass)}`;
        lines.push(`;CLASS ${cls} ${color}${lw}`);
    }
    return `${lines.join("\n")}\n`;
}
