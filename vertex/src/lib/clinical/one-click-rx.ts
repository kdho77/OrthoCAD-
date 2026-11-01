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
    { re: /\bdancer(?:'s|s)?\s+pads?\b/i, kind: "dancers_pad" },
];

/**
 * "medial skive" with no millimetres. The existing prescription heuristic
 * already writes 4 mm for that phrase. This is the medial-skive slider, not
 * a new shape.
 */
export const UNSPECIFIED_MEDIAL_SKIVE_MM = 4;

const MPJ_ORDINALS = "1st|first|2nd|second|3rd|third|4th|fourth|5th|fifth";

/** "1st MPJ 2 mm" is the 1st MPJ at 2 mm, not also the 2nd MPJ. */
function mpjRule(ordinal: string, digit: string): RegExp {
    return new RegExp(
        String.raw`\b(?:${ordinal})\s*mpj\b|(?<!(?:${MPJ_ORDINALS})\s*)\bmpj\s*${digit}\b`,
        "i",
    );
}

const SINK_RULES: { re: RegExp; kind: SinkKind }[] = [
    { re: mpjRule("1st|first", "1"), kind: "mpj1" },
    { re: mpjRule("2nd|second", "2"), kind: "mpj2" },
    { re: mpjRule("3rd|third", "3"), kind: "mpj3" },
    { re: mpjRule("4th|fourth", "4"), kind: "mpj4" },
    { re: mpjRule("5th|fifth", "5"), kind: "mpj5" },
    { re: /\bstyloid\b/i, kind: "styloid" },
];

const SIGNED_MM = String.raw`[+-]?\s*\d+(?:\.\d+)?\s*mm`;

function numberIn(text: string, re: RegExp): number | undefined {
    const m = text.match(re);
    if (!m) return undefined;
    const n = m[0].match(/[+-]?\s*\d+(?:\.\d+)?/);
    if (!n) return undefined;
    return Number(n[0].replace(/\s+/g, ""));
}

function wedgeDegrees(clause: string, zone: "rear" | "fore"): number | undefined {
    const word = `${zone}\\s*foot`;
    const after = numberIn(clause, new RegExp(`${word}[^.]{0,32}?-?\\d+(?:\\.\\d+)?\\s*(?:deg|°)`, "i"));
    if (after !== undefined) return after;
    return numberIn(clause, new RegExp(`-?\\d+(?:\\.\\d+)?\\s*(?:deg|°)\\s*${word}`, "i"));
}

type SideWord = { side: Side; index: number; end: number };

function sideWords(text: string): SideWord[] {
    const out: SideWord[] = [];
    const re = /\b(left|right)\b/gi;
    for (const match of text.matchAll(re)) {
        const word = match[1];
        if (!word) continue;
        const index = match.index ?? 0;
        out.push({ side: word.toLowerCase() as Side, index, end: index + word.length });
    }
    return out;
}

function uniqueSides(words: SideWord[]): Side[] {
    const sides: Side[] = [];
    for (const word of words) {
        if (!sides.includes(word.side)) sides.push(word.side);
    }
    return sides;
}

/** "left and right met pad" names one item for both feet. */
function isBilateralLabel(text: string, words: SideWord[]): boolean {
    const first = words[0];
    const second = words[1];
    if (words.length !== 2 || !first || !second || first.side === second.side) return false;
    if (text.slice(0, first.index).trim() !== "") return false;
    const between = text.slice(first.end, second.index);
    if (!/^\s*(?:and|&)\s*$/i.test(between)) return false;
    return text.slice(second.end).trim().length > 0;
}

/**
 * A clause that names both feet is split so each item stays on its own foot.
 * "dancer pad left, medial skive right" does not copy either item across.
 */
function splitMixedSides(text: string, words: SideWord[]): { text: string; side: Side }[] | null {
    const first = words[0];
    if (!first || uniqueSides(words).length < 2 || isBilateralLabel(text, words)) return null;
    const leading = text.slice(0, first.index).trim() === "";
    if (leading) {
        return words
            .map((word, i) => {
                const next = words[i + 1];
                const end = next ? next.index : text.length;
                return { text: text.slice(word.index, end).trim(), side: word.side };
            })
            .filter((part) => part.text.length > 0);
    }
    const parts: { text: string; side: Side }[] = [];
    let cursor = 0;
    for (const word of words) {
        const chunk = text.slice(cursor, word.end).trim();
        if (chunk) parts.push({ text: chunk, side: word.side });
        cursor = word.end;
    }
    const tail = text.slice(cursor).trim();
    const last = parts[parts.length - 1];
    if (tail && last) last.text = `${last.text} ${tail}`;
    return parts.length > 0 ? parts : null;
}

type PieceSides = Side[] | "ambiguous" | "absent";

function resolvePieceSides(text: string, clause: string, present: Side[]): PieceSides {
    const named = uniqueSides(sideWords(text));
    if (named.length > 0) {
        const local = named.filter((side) => present.includes(side));
        return local.length > 0 ? local : "absent";
    }
    const clauseNamed = uniqueSides(sideWords(clause));
    if (clauseNamed.length === 1) {
        const inherited = clauseNamed.filter((side) => present.includes(side));
        return inherited.length > 0 ? inherited : "absent";
    }
    if (clauseNamed.length > 1) return "ambiguous";
    if (present.length === 1) return present;
    return "ambiguous";
}

function piecesOf(clause: string, present: Side[]): { text: string; sides: PieceSides }[] {
    const segments = clause
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const chunks = segments.length > 0 ? segments : [clause];
    const pieces: { text: string; sides: PieceSides }[] = [];
    for (const segment of chunks) {
        const words = sideWords(segment);
        if (isBilateralLabel(segment, words)) {
            const sides = uniqueSides(words).filter((side) => present.includes(side));
            pieces.push({ text: segment, sides: sides.length > 0 ? sides : "absent" });
            continue;
        }
        const mixed = splitMixedSides(segment, words);
        if (mixed) {
            for (const part of mixed) {
                pieces.push({
                    text: part.text,
                    sides: present.includes(part.side) ? [part.side] : "absent",
                });
            }
            continue;
        }
        pieces.push({ text: segment, sides: resolvePieceSides(segment, clause, present) });
    }
    return pieces;
}

function pieceHasAction(text: string): boolean {
    return (
        /\d/.test(text) ||
        ELEMENT_RULES.some((rule) => rule.re.test(text)) ||
        SINK_RULES.some((rule) => rule.re.test(text)) ||
        /\b(?:medial|lateral)\s*(?:heel\s*)?skive\b/i.test(text)
    );
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
        for (const piece of piecesOf(clause, present)) {
            if (piece.sides === "ambiguous") {
                if (pieceHasAction(piece.text)) {
                    out.warnings.push(`Ambiguous side — not applied: "${piece.text}"`);
                }
                continue;
            }
            if (piece.sides === "absent") continue;
            const presentSides = piece.sides;
            const text = piece.text;

            const medialSkive = numberIn(
                text,
                new RegExp(String.raw`medial\s*(?:heel\s*)?skive[^.]{0,24}?${SIGNED_MM}`, "i"),
            );
            if (medialSkive !== undefined) addPatch(out, presentSides, { medialSkiveMm: medialSkive });
            else if (/\bmedial\s*(?:heel\s*)?skive\b/i.test(text)) {
                addPatch(out, presentSides, { medialSkiveMm: UNSPECIFIED_MEDIAL_SKIVE_MM });
            }
            const lateralSkive = numberIn(
                text,
                new RegExp(String.raw`lateral\s*(?:heel\s*)?skive[^.]{0,24}?${SIGNED_MM}`, "i"),
            );
            if (lateralSkive !== undefined) addPatch(out, presentSides, { lateralSkiveMm: lateralSkive });

            const rear = wedgeDegrees(text, "rear");
            if (rear !== undefined) {
                let wedgeSide: "medial" | "lateral" = rear > 0 ? "lateral" : "medial";
                if (/\bvarus\b/i.test(text)) wedgeSide = "medial";
                else if (/\bvalgus\b/i.test(text)) wedgeSide = "lateral";
                addPatch(out, presentSides, {
                    rearfootWedge: { side: wedgeSide, value: Math.abs(rear), unit: "deg" },
                });
            }
            const fore = wedgeDegrees(text, "fore");
            if (fore !== undefined) {
                const wedgeSide: "medial" | "lateral" =
                    /\bvarus\b/i.test(text) || fore < 0 ? "medial" : "lateral";
                addPatch(out, presentSides, {
                    forefootWedge: { side: wedgeSide, value: Math.abs(fore), unit: "deg" },
                });
            }

            const heelCup = numberIn(text, new RegExp(String.raw`heel\s*cup[^.]{0,24}?${SIGNED_MM}`, "i"));
            if (heelCup !== undefined) addPatch(out, presentSides, { heelCupDepthMm: heelCup });
            let arch = numberIn(
                text,
                new RegExp(String.raw`\barch(?:\s*height)?\s*[:=]?\s*${SIGNED_MM}\b`, "i"),
            );
            if (arch === undefined) {
                const bare = text.replace(/\b(?:left|right)\b/gi, "").trim();
                if (/^[+-]\s*\d+(?:\.\d+)?\s*mm$/i.test(bare)) {
                    arch = numberIn(bare, new RegExp(SIGNED_MM, "i"));
                }
            }
            if (arch !== undefined) addPatch(out, presentSides, { archHeightMm: arch });
            const apex = numberIn(
                text,
                new RegExp(String.raw`\bapex(?:\s*move)?\s*[:=]?\s*${SIGNED_MM}\b`, "i"),
            );
            if (apex !== undefined) addPatch(out, presentSides, { apexMoveMm: apex });
            const lift = numberIn(text, new RegExp(String.raw`heel\s*lift[^.]{0,16}?${SIGNED_MM}`, "i"));
            if (lift !== undefined) addPatch(out, presentSides, { heelLiftMm: lift });

            for (const rule of ELEMENT_RULES) {
                if (!rule.re.test(text)) continue;
                if (rule.kind === "mortons_extension" && /reverse\s*morton/i.test(text)) continue;
                for (const side of presentSides) out.elements.push({ kind: rule.kind, side });
            }
            for (const rule of SINK_RULES) {
                if (!rule.re.test(text)) continue;
                const depth = numberIn(text, new RegExp(SIGNED_MM, "i"));
                for (const side of presentSides) out.sinks.push({ kind: rule.kind, side, depthMm: depth });
            }
        }
    }

    const hasExplicit =
        Object.keys(out.correctionsBySide).length > 0 || out.elements.length > 0 || out.sinks.length > 0;
    out.pathologyOnly = out.pathologyMentioned && !hasExplicit;
    return out;
}
