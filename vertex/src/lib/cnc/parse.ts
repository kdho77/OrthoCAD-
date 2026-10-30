// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

const KNOWN = new Set(["G", "M", "X", "Y", "Z", "F", "S", "P", "T"]);

export interface ParsedWord {
    letter: string;
    value: number;
}

export interface ParsedLine {
    n: number;
    raw: string;
    comment?: string;
    words: ParsedWord[];
}

export interface MachineState {
    x: number;
    y: number;
    z: number;
    f: number;
    s: number;
    spindleOn: boolean;
    motion: "G0" | "G1" | null;
}

export interface ParsedMove {
    line: number;
    raw: string;
    motion: "G0" | "G1";
    x: number;
    y: number;
    z: number;
    f: number;
    from: { x: number; y: number; z: number };
}

export interface ParseResult {
    lines: ParsedLine[];
    moves: ParsedMove[];
    unknownWords: string[];
    minZ: number;
    maxZ: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    g0BelowClearance: boolean;
    spindleOnBeforeFirstCut: boolean;
    firstCutLine: number | null;
}

function stripComments(raw: string): { code: string; comment?: string } {
    let comment: string | undefined;
    let code = raw;
    const sc = code.indexOf(";");
    if (sc >= 0) {
        comment = code.slice(sc + 1).trim();
        code = code.slice(0, sc);
    }
    const out: string[] = [];
    let i = 0;
    while (i < code.length) {
        if (code[i] === "(") {
            const j = code.indexOf(")", i + 1);
            const c = code.slice(i + 1, j < 0 ? code.length : j).trim();
            comment = comment ? `${comment} ${c}` : c;
            i = j < 0 ? code.length : j + 1;
            continue;
        }
        out.push(code[i]!);
        i++;
    }
    return { code: out.join(""), comment };
}

const WORD = /([A-Za-z])([+-]?(?:\d+\.?\d*|\.\d+))/g;

export function parseGcode(text: string, clearanceZ = 50): ParseResult {
    const lines: ParsedLine[] = [];
    const unknownWords: string[] = [];
    const moves: ParsedMove[] = [];
    const st: MachineState = { x: 0, y: 0, z: 0, f: 0, s: 0, spindleOn: false, motion: null };
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let g0BelowClearance = false;
    let firstCutLine: number | null = null;
    let spindleOnBeforeFirstCut = true;
    const rawLines = text.split(/\r?\n/);
    for (let n = 0; n < rawLines.length; n++) {
        const raw = rawLines[n]!;
        if (!raw.trim()) continue;
        const { code, comment } = stripComments(raw);
        const words: ParsedWord[] = [];
        const trimmed = code.trim();
        if (trimmed) {
            WORD.lastIndex = 0;
            let m: RegExpExecArray | null = WORD.exec(trimmed);
            let consumed = 0;
            while (m) {
                const letter = m[1]!.toUpperCase();
                const value = Number(m[2]);
                if (!KNOWN.has(letter)) unknownWords.push(`${letter}${m[2]}@${n + 1}`);
                words.push({ letter, value });
                consumed += m[0].length;
                m = WORD.exec(trimmed);
            }
            const leftover = trimmed.replace(/\s+/g, "").length - consumed;
            if (leftover > 0) {
                const junk = trimmed.replace(WORD, "").replace(/\s+/g, "");
                if (junk) unknownWords.push(`${junk}@${n + 1}`);
            }
        }
        lines.push({ n: n + 1, raw, comment, words });

        let g: number | null = null;
        let mm: number | null = null;
        const from = { x: st.x, y: st.y, z: st.z };
        for (const w of words) {
            if (w.letter === "G") g = w.value;
            else if (w.letter === "M") mm = w.value;
            else if (w.letter === "X") st.x = w.value;
            else if (w.letter === "Y") st.y = w.value;
            else if (w.letter === "Z") st.z = w.value;
            else if (w.letter === "F") st.f = w.value;
            else if (w.letter === "S") st.s = w.value;
        }
        if (mm === 3) st.spindleOn = true;
        if (mm === 5) st.spindleOn = false;
        const motion = g === 0 ? "G0" : g === 1 ? "G1" : null;
        if (motion) {
            st.motion = motion;
            if (motion === "G0" && st.z < clearanceZ - 1e-6) g0BelowClearance = true;
            if (motion === "G1") {
                if (firstCutLine === null) {
                    firstCutLine = n + 1;
                    spindleOnBeforeFirstCut = st.spindleOn;
                }
            }
            moves.push({
                line: n + 1,
                raw,
                motion,
                x: st.x,
                y: st.y,
                z: st.z,
                f: st.f,
                from,
            });
            minZ = Math.min(minZ, st.z);
            maxZ = Math.max(maxZ, st.z);
            minX = Math.min(minX, st.x);
            maxX = Math.max(maxX, st.x);
            minY = Math.min(minY, st.y);
            maxY = Math.max(maxY, st.y);
        }
    }
    return {
        lines,
        moves,
        unknownWords,
        minZ: Number.isFinite(minZ) ? minZ : 0,
        maxZ: Number.isFinite(maxZ) ? maxZ : 0,
        minX: Number.isFinite(minX) ? minX : 0,
        maxX: Number.isFinite(maxX) ? maxX : 0,
        minY: Number.isFinite(minY) ? minY : 0,
        maxY: Number.isFinite(maxY) ? maxY : 0,
        g0BelowClearance,
        spindleOnBeforeFirstCut,
        firstCutLine,
    };
}
