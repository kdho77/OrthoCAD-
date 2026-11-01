// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ElementKind, Side, SideCorrections, SinkKind } from "@/types";

const PATHOLOGY =
    /\b(pes\s+planus|pes\s+cavus|plantar\s+fasci\w*|fasciitis|pronat\w*|supinat\w*|pttd|posterior\s+tibial|neuroma|metatarsalgia|hallux|bunion|flat\s*foot|high\s+arch|low\s+arch|tendin\w*|arthritis|neuropath\w*)\b/i;

export type ExplicitRx = {
    correctionsBySide: Partial<Record<Side, Partial<SideCorrections>>>;
    elements: { kind: ElementKind; side: Side }[];
    sinks: { kind: SinkKind; side: Side; depthMm?: number }[];
    /** Pathology words with no explicit correction, element, or sink. */
    pathologyOnly: boolean;
    pathologyMentioned: boolean;
    warnings: string[];
};

const ELEMENT_RULES: { re: RegExp; kind: ElementKind }[] = [
    { re: /\bmet(?:atarsal)?\s*pads?\b/i, kind: "met_pad" },
    { re: /\bmet(?:atarsal)?\s*bars?\b/i, kind: "met_bar" },
    { re: /\bcluffy\b/i, kind: "cluffy_wedge" },
    { re: /\breverse\s*morton/i, kind: "reverse_mortons" },
    { re: /\bmorton(?:'s|s)?(?:\s+extension)?\b/i, kind: "mortons_extension" },
    { re: /\bkinetic\s*wedge\b/i, kind: "kinetic_wedge" },
    { re: /\bnavicular(?:\s+sink)?\b/i, kind: "navicular_sink" },
    { re: /\bheel\s*sink\b/i, kind: "heel_sink" },
];

const SINK_RULES: { re: RegExp; kind: SinkKind }[] = [
    { re: /\b(?:1st|first)\s*mpj\b|\bmpj\s*1\b/i, kind: "mpj1" },
    { re: /\b(?:2nd|second)\s*mpj\b|\bmpj\s*2\b/i, kind: "mpj2" },
    { re: /\b(?:3rd|third)\s*mpj\b|\bmpj\s*3\b/i, kind: "mpj3" },
    { re: /\b(?:4th|fourth)\s*mpj\b|\bmpj\s*4\b/i, kind: "mpj4" },
    { re: /\b(?:5th|fifth)\s*mpj\b|\bmpj\s*5\b/i, kind: "mpj5" },
    { re: /\bstyloid\b/i, kind: "styloid" },
];

function numberIn(text: string, re: RegExp): number | undefined {
    const m = text.match(re);
    if (!m) return undefined;
    const n = m[0].match(/-?\d+(\.\d+)?/);
    return n ? Number(n[0]) : undefined;
}

function wedgeDegrees(clause: string, zone: "rear" | "fore"): number | undefined {
    const word = `${zone}\\s*foot`;
    const after = numberIn(clause, new RegExp(`${word}[^.]{0,32}?-?\\d+(?:\\.\\d+)?\\s*(?:deg|°)`, "i"));
    if (after !== undefined) return after;
    return numberIn(clause, new RegExp(`-?\\d+(?:\\.\\d+)?\\s*(?:deg|°)\\s*${word}`, "i"));
}

function sidesFor(clause: string, present: Side[]): Side[] | "ambiguous" {
    const left = /\bleft\b/i.test(clause);
    const right = /\bright\b/i.test(clause);
    if (left && right) return ["left", "right"];
    if (left) return ["left"];
    if (right) return ["right"];
    if (present.length === 1) return present;
    return "ambiguous";
}

function addPatch(out: ExplicitRx, sides: Side[], patch: Partial<SideCorrections>): void {
    for (const side of sides) {
        out.correctionsBySide[side] = { ...out.correctionsBySide[side], ...patch };
    }
}

/**
 * Pull only explicit Rx items. Named diagnoses do not become millimetres
 * or degrees. A clause with no Left/Right, when both feet are present, is
 * flagged and skipped.
 */
export function interpretOneClickRx(text: string, present: Side[]): ExplicitRx {
    const out: ExplicitRx = {
        correctionsBySide: {},
        elements: [],
        sinks: [],
        pathologyOnly: false,
        pathologyMentioned: PATHOLOGY.test(text),
        warnings: [],
    };
    const clauses = text
        .split(/[.;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    const chunks = clauses.length > 0 ? clauses : text.trim() ? [text.trim()] : [];

    for (const clause of chunks) {
        const sides = sidesFor(clause, present);
        if (sides === "ambiguous") {
            if (
                /\d/.test(clause) ||
                ELEMENT_RULES.some((r) => r.re.test(clause)) ||
                SINK_RULES.some((r) => r.re.test(clause))
            ) {
                out.warnings.push(`Ambiguous side — not applied: "${clause}"`);
            }
            continue;
        }
        const presentSides = sides.filter((s) => present.includes(s));
        if (presentSides.length === 0) continue;

        const medialSkive = numberIn(clause, /medial\s*(?:heel\s*)?skive[^.]{0,24}?\d+(?:\.\d+)?\s*mm/i);
        if (medialSkive !== undefined) addPatch(out, presentSides, { medialSkiveMm: medialSkive });
        const lateralSkive = numberIn(clause, /lateral\s*(?:heel\s*)?skive[^.]{0,24}?\d+(?:\.\d+)?\s*mm/i);
        if (lateralSkive !== undefined) addPatch(out, presentSides, { lateralSkiveMm: lateralSkive });

        const rear = wedgeDegrees(clause, "rear");
        if (rear !== undefined) {
            let wedgeSide: "medial" | "lateral" = rear > 0 ? "lateral" : "medial";
            if (/\bvarus\b/i.test(clause)) wedgeSide = "medial";
            else if (/\bvalgus\b/i.test(clause)) wedgeSide = "lateral";
            addPatch(out, presentSides, {
                rearfootWedge: { side: wedgeSide, value: Math.abs(rear), unit: "deg" },
            });
        }
        const fore = wedgeDegrees(clause, "fore");
        if (fore !== undefined) {
            const wedgeSide: "medial" | "lateral" =
                /\bvarus\b/i.test(clause) || fore < 0 ? "medial" : "lateral";
            addPatch(out, presentSides, {
                forefootWedge: { side: wedgeSide, value: Math.abs(fore), unit: "deg" },
            });
        }

        const heelCup = numberIn(clause, /heel\s*cup[^.]{0,24}?\d+(?:\.\d+)?\s*mm/i);
        if (heelCup !== undefined) addPatch(out, presentSides, { heelCupDepthMm: heelCup });
        const arch = numberIn(clause, /\barch(?:\s*height)?\s*[:=]?\s*-?\d+(?:\.\d+)?\s*mm\b/i);
        if (arch !== undefined) addPatch(out, presentSides, { archHeightMm: arch });
        const apex = numberIn(clause, /\bapex(?:\s*move)?\s*[:=]?\s*-?\d+(?:\.\d+)?\s*mm\b/i);
        if (apex !== undefined) addPatch(out, presentSides, { apexMoveMm: apex });
        const lift = numberIn(clause, /heel\s*lift[^.]{0,16}?\d+(?:\.\d+)?\s*mm/i);
        if (lift !== undefined) addPatch(out, presentSides, { heelLiftMm: lift });

        for (const rule of ELEMENT_RULES) {
            if (!rule.re.test(clause)) continue;
            if (rule.kind === "mortons_extension" && /reverse\s*morton/i.test(clause)) continue;
            for (const side of presentSides) out.elements.push({ kind: rule.kind, side });
        }
        for (const rule of SINK_RULES) {
            if (!rule.re.test(clause)) continue;
            const depth = numberIn(clause, /\d+(?:\.\d+)?\s*mm/i);
            for (const side of presentSides) out.sinks.push({ kind: rule.kind, side, depthMm: depth });
        }
    }

    const hasExplicit =
        Object.keys(out.correctionsBySide).length > 0 || out.elements.length > 0 || out.sinks.length > 0;
    out.pathologyOnly = out.pathologyMentioned && !hasExplicit;
    return out;
}
