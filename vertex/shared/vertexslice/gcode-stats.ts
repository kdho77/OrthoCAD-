// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export interface GcodeStats {
    printTimeSeconds: number | null;
    filamentGrams: number | null;
    filamentMeters: number | null;
    layers: number | null;
}

function parseDuration(raw: string): number | null {
    const h = /(\d+)\s*h/.exec(raw);
    const m = /(\d+)\s*m/.exec(raw);
    const s = /(\d+)\s*s/.exec(raw);
    if (!h && !m && !s) return null;
    return (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (s ? Number(s[1]) : 0);
}

function firstNumber(source: string, patterns: RegExp[]): number | null {
    for (const pattern of patterns) {
        const match = pattern.exec(source);
        if (match?.[1]) {
            const n = Number(match[1]);
            if (Number.isFinite(n)) return n;
        }
    }
    return null;
}

/** Parse Orca/Cura-style header comments from sliced G-code. */
export function parseGcodeStats(gcode: string): GcodeStats {
    const filamentMm = firstNumber(gcode, [
        /;\s*filament used \[mm\]\s*=\s*([\d.]+)/i,
        /;\s*filament used\s*=\s*([\d.]+)\s*mm/i,
    ]);
    const filamentGrams = firstNumber(gcode, [
        /;\s*total filament used \[g\]\s*=\s*([\d.]+)/i,
        /;\s*filament used \[g\]\s*=\s*([\d.]+)/i,
        /;\s*filament used\s*=\s*([\d.]+)\s*g/i,
    ]);
    const layers = firstNumber(gcode, [
        /;\s*total layers count\s*=\s*(\d+)/i,
        /;\s*layer_count\s*=\s*(\d+)/i,
        /;\s*LAYER_COUNT:(\d+)/i,
    ]);
    const timeMatch =
        /;\s*estimated printing time(?:\s*\([^)]*\))?\s*=\s*([^\n;]+)/i.exec(gcode) ??
        /;\s*print time\s*=\s*([^\n;]+)/i.exec(gcode);
    return {
        printTimeSeconds: timeMatch?.[1] ? parseDuration(timeMatch[1]) : null,
        filamentGrams,
        filamentMeters: filamentMm == null ? null : filamentMm / 1000,
        layers: layers == null ? null : Math.round(layers),
    };
}

export function formatPrintTime(seconds: number | null): string {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
}
