// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/** Dev console + optional performance.mark for load/export orchestration. */

const PREFIX = "orthocad";

export type LoadPerfMark =
    | "load:fetch"
    | "load:parse"
    | "load:first-paint"
    | "load:base-resolved"
    | "load:pattern-done";

export type ExportPerfMark =
    | "export:loft"
    | "export:close"
    | "export:validate"
    | "export:stl"
    | "export:upload"
    | "export:server-slice";

function markName(name: LoadPerfMark | ExportPerfMark): string {
    return `${PREFIX}:${name}`;
}

export function perfMark(name: LoadPerfMark | ExportPerfMark, detail?: Record<string, unknown>): void {
    if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
    try {
        performance.mark(markName(name));
    } catch {
        /* duplicate or unavailable */
    }
    const dev =
        typeof process !== "undefined" && process.env?.NODE_ENV === "development"
            ? true
            : typeof import.meta !== "undefined" &&
              (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
    if (dev && typeof console !== "undefined") {
        console.debug(`[perf] ${name}`, detail ?? "");
    }
}

export function perfMeasure(
    name: string,
    start: LoadPerfMark | ExportPerfMark,
    end: LoadPerfMark | ExportPerfMark,
): number | null {
    if (typeof performance === "undefined" || typeof performance.measure !== "function") return null;
    const startMark = markName(start);
    const endMark = markName(end);
    try {
        performance.measure(`${PREFIX}:${name}`, startMark, endMark);
        const entries = performance.getEntriesByName(`${PREFIX}:${name}`);
        const last = entries[entries.length - 1];
        return last?.duration ?? null;
    } catch {
        return null;
    }
}
