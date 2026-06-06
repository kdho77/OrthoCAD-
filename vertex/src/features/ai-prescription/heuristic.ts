import type { ParsedElement, PrescriptionParseResult, Side, SideCorrections } from "@/types";

// Offline keyword-based prescription parser used when no AI provider/API is
// configured (dev/preview). It is intentionally simple — the real parsing runs
// server-side via the AI provider — but lets the full upload→params flow work.

type Patch = Partial<SideCorrections>;

function targetSides(text: string): Side[] {
    const left = /\bleft\b|\bL\b/i.test(text);
    const right = /\bright\b|\bR\b/i.test(text);
    if (left && !right) return ["left"];
    if (right && !left) return ["right"];
    return ["left", "right"];
}

function firstNumber(text: string, near: RegExp): number | undefined {
    const m = text.match(near);
    if (!m) return undefined;
    const num = m[0].match(/-?\d+(\.\d+)?/);
    return num ? Number(num[0]) : undefined;
}

export function heuristicParse(text: string): PrescriptionParseResult {
    const lower = text.toLowerCase();
    const corrections: { left?: Patch; right?: Patch } = {};
    const elements: ParsedElement[] = [];

    const apply = (patch: Patch) => {
        for (const side of targetSides(text)) {
            corrections[side] = { ...corrections[side], ...patch };
        }
    };

    const rearfoot = firstNumber(lower, /rear\s*foot[^.]*?-?\d+(\.\d+)?\s*(deg|°)/);
    if (rearfoot !== undefined) apply({ rearfootPostingDeg: rearfoot });
    const forefoot = firstNumber(lower, /fore\s*foot[^.]*?-?\d+(\.\d+)?\s*(deg|°)/);
    if (forefoot !== undefined) apply({ forefootPostingDeg: forefoot });

    if (/pronat/.test(lower) && rearfoot === undefined) apply({ rearfootPostingDeg: 4 });
    if (/supinat/.test(lower) && rearfoot === undefined) apply({ rearfootPostingDeg: -4 });

    const medialSkive = firstNumber(lower, /medial\s*(heel\s*)?skive[^.]*?\d+(\.\d+)?\s*mm/);
    if (medialSkive !== undefined) apply({ medialSkiveMm: medialSkive });
    else if (/medial\s*(heel\s*)?skive/.test(lower)) apply({ medialSkiveMm: 4 });
    const lateralSkive = firstNumber(lower, /lateral\s*(heel\s*)?skive[^.]*?\d+(\.\d+)?\s*mm/);
    if (lateralSkive !== undefined) apply({ lateralSkiveMm: lateralSkive });

    const archHeight = firstNumber(lower, /arch[^.]*?\d+(\.\d+)?\s*mm/);
    if (archHeight !== undefined) apply({ archHeightMm: archHeight });
    else if (/high arch|pes cavus/.test(lower)) apply({ archHeightMm: 14 });
    else if (/low arch|flat ?foot|pes planus/.test(lower)) apply({ archFillMm: 4 });

    const heelCup = firstNumber(lower, /heel\s*cup[^.]*?\d+(\.\d+)?\s*mm/);
    if (heelCup !== undefined) apply({ heelCupDepthMm: heelCup });
    else if (/deep heel cup/.test(lower)) apply({ heelCupDepthMm: 16 });

    const elementMap: { re: RegExp; kind: ParsedElement["kind"] }[] = [
        { re: /met(atarsal)?\s*pad/, kind: "met_pad" },
        { re: /met(atarsal)?\s*bar/, kind: "met_bar" },
        { re: /cluffy/, kind: "cluffy_wedge" },
        { re: /reverse\s*morton/, kind: "reverse_mortons" },
        { re: /morton/, kind: "mortons_extension" },
        { re: /kinetic\s*wedge/, kind: "kinetic_wedge" },
        { re: /navicular/, kind: "navicular_sink" },
        { re: /heel\s*sink/, kind: "heel_sink" },
    ];
    for (const { re, kind } of elementMap) {
        if (re.test(lower) && !(kind === "mortons_extension" && /reverse\s*morton/.test(lower))) {
            for (const side of targetSides(text)) elements.push({ kind, side });
        }
    }

    const result: PrescriptionParseResult = {
        corrections,
        elements,
        notes: "Parsed locally (heuristic). Configure AI_API_KEY for full AI parsing.",
        confidence: 0.4,
        provider: "heuristic",
        tokenCost: 0,
    };

    if (/shell/.test(lower)) result.method = "printing_shell";
    else if (/mill|cnc/.test(lower)) result.method = "milling_3axis";
    if (/prefab/.test(lower)) result.pattern = "prefab_3d";

    return result;
}
