// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Canonical user-facing export filenames: First_Last_Material_L|R|LR.ext

export const EXPORT_PATIENT_FALLBACK = "Unknown_Patient";
export const DEFAULT_EXPORT_MATERIAL_ID = "ApexCore";

export type ExportFilenameSide = "L" | "R" | "LR";

export interface BuildExportFilenameInput {
    firstName?: string | null;
    lastName?: string | null;
    /** Canonical OrthoCAD product id, e.g. ApexLight or apex_light. */
    material: string;
    side: ExportFilenameSide;
    /** With or without a leading dot. */
    ext: string;
}

const MATERIAL_ID_BY_COMPACT = new Map<string, string>([
    ["apexlight", "ApexLight"],
    ["apexlightfoam", "ApexLight"],
    ["apexcore", "ApexCore"],
    ["apexcomfort", "ApexCore"],
    ["apexbounce", "ApexBounce"],
    ["apexforge", "ApexForge"],
    ["apex_light", "ApexLight"],
    ["apex_core", "ApexCore"],
    ["apex_bounce", "ApexBounce"],
    ["apex_forge", "ApexForge"],
]);

function compactMaterialKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

/** Resolve caller, slicer, or order strings to the canonical Apex product id used in filenames. */
export function canonicalExportMaterialName(material: string | null | undefined): string {
    const raw = material?.trim() ?? "";
    if (!raw) return DEFAULT_EXPORT_MATERIAL_ID;
    const compact = compactMaterialKey(raw);
    const mapped = MATERIAL_ID_BY_COMPACT.get(compact);
    if (mapped) return mapped;
    if (/^apex[a-z]+$/i.test(raw.replace(/[\s_-]+/g, ""))) {
        const title = raw.replace(/[\s_-]+/g, "");
        const match = title.match(/^apex(.+)$/i);
        if (match?.[1]) {
            const tail = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
            return `Apex${tail}`;
        }
    }
    return sanitizeFilenamePart(raw);
}

const UNSAFE_FILENAME_PART = /[^\p{L}\p{N}.'’-]+/gu;

/** Keep patient capitalization; strip or hyphenate unsafe characters inside a name part. */
export function sanitizeFilenamePart(part: string | null | undefined): string {
    const trimmed = part?.trim() ?? "";
    if (!trimmed) return "";
    return trimmed
        .replace(UNSAFE_FILENAME_PART, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function exportPatientFilenameSegment(firstName?: string | null, lastName?: string | null): string {
    const first = sanitizeFilenamePart(firstName);
    const last = sanitizeFilenamePart(lastName);
    const parts = [first, last].filter(Boolean);
    if (parts.length === 0) return EXPORT_PATIENT_FALLBACK;
    return parts.join("_");
}

/** Queue shorthand like JD or AM — not used as a legal first name for export filenames. */
export function looksLikeInitialsLabel(label: string | null | undefined): boolean {
    const trimmed = label?.trim() ?? "";
    if (!trimmed) return true;
    if (/\s/.test(trimmed)) return false;
    return trimmed.length <= 4;
}

export interface ProductionExportPatientSource {
    clientFirstName?: string | null;
    clientLastName?: string | null;
    clientLabel?: string | null;
}

/**
 * Prefer chart first/last. Use a multi-word display label only when it is not initials.
 * Otherwise return empty parts so the caller can fall back to Unknown_Patient.
 */
export function exportPatientPartsForProduction(input: ProductionExportPatientSource): {
    firstName: string;
    lastName: string;
} {
    const first = sanitizeFilenamePart(input.clientFirstName);
    const last = sanitizeFilenamePart(input.clientLastName);
    if (first || last) return { firstName: first, lastName: last };
    const label = input.clientLabel?.trim() ?? "";
    if (label && !looksLikeInitialsLabel(label)) {
        return parsePatientNameForExport(label);
    }
    return { firstName: "", lastName: "" };
}

export function parsePatientNameForExport(patientName?: string | null): {
    firstName: string;
    lastName: string;
} {
    const trimmed = patientName?.trim() ?? "";
    if (!trimmed) return { firstName: "", lastName: "" };
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { firstName: "", lastName: "" };
    if (tokens.length === 1) return { firstName: tokens[0] ?? "", lastName: "" };
    return { firstName: tokens[0] ?? "", lastName: tokens.slice(1).join(" ") };
}

export function exportSideSuffix(side: "left" | "right" | null | undefined): ExportFilenameSide;
export function exportSideSuffix(sides: ReadonlyArray<"left" | "right">): ExportFilenameSide;
export function exportSideSuffix(
    side: "left" | "right" | ReadonlyArray<"left" | "right"> | null | undefined,
): ExportFilenameSide {
    if (Array.isArray(side)) {
        const uniq = [...new Set(side)];
        if (uniq.length > 1) return "LR";
        return uniq[0] === "right" ? "R" : "L";
    }
    return side === "right" ? "R" : "L";
}

function normalizeExtension(ext: string): string {
    const trimmed = ext.trim();
    if (!trimmed) return "";
    return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function buildExportFilename(input: BuildExportFilenameInput): string {
    const patient = exportPatientFilenameSegment(input.firstName, input.lastName);
    const material = canonicalExportMaterialName(input.material);
    const extension = normalizeExtension(input.ext);
    return `${patient}_${material}_${input.side}${extension}`;
}
