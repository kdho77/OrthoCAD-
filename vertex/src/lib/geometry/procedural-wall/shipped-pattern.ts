// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureCcw, type PolyPoint, startAtPosteriorHeel } from "./curves";

export const SHIPPED_PATTERN_SOURCE_SHA = "a2f7cc61bd6242d45f302342addfac35be87aa83";
export const SHIPPED_PATTERN_JSON = "sample-top-full-contact.json";
export const SHIPPED_STYLE_METRICS_JSON = "sample-top-style-metrics.json";
/** Soft-metric ratchet vs the frozen a2f7cc61 SAMPLE_Top styles. */
export const SHIPPED_RATCHET_DEG = 0.5;
/** Hausdorff of the shipped pattern to the scaled DXF trace. */
export const SHIPPED_PATTERN_HAUSDORFF_MM = 1.5;

export interface ShippedPatternBaseline {
    sourceSha: string;
    rimHash: string;
    patternHash: string;
    controls: PolyPoint[];
    samples: PolyPoint[];
    curvature?: { inflections: number; maxAbsDkDs: number; lateralMinK: number };
}

export interface ShippedStyleMetrics {
    sourceSha: string;
    stlMd5: string;
    stlBytes: number;
    watertight: boolean;
    openEdges: number;
    nonManifoldEdges: number;
    windingConsistent: boolean;
    oppositeEdgeMismatch: number;
    signedVolume: number;
    selfIntersections: number;
    plantarAbsMaxZ: number;
    acrossP99: number;
    acrossP100: number;
    eTurn: number;
    fTurn: number;
    alongRow: number;
    g1Rm: number;
    g1RAnalytic: number;
    g1EAnalytic: number;
    g1BAnalytic: number;
    infl: number;
}

function here(): string {
    return dirname(fileURLToPath(import.meta.url));
}

function loadPattern(): ShippedPatternBaseline {
    const raw = readFileSync(resolve(here(), "baselines", SHIPPED_PATTERN_JSON), "utf8");
    return JSON.parse(raw) as ShippedPatternBaseline;
}

function loadMetrics(): Record<"straight" | "round" | "hybrid", ShippedStyleMetrics> {
    const raw = readFileSync(resolve(here(), "baselines", SHIPPED_STYLE_METRICS_JSON), "utf8");
    return JSON.parse(raw) as Record<"straight" | "round" | "hybrid", ShippedStyleMetrics>;
}

let cachedPattern: ShippedPatternBaseline | null = null;
let cachedMetrics: Record<"straight" | "round" | "hybrid", ShippedStyleMetrics> | null = null;

function data(): ShippedPatternBaseline {
    cachedPattern ??= loadPattern();
    return cachedPattern;
}

export function hashClosedLoop(points: ReadonlyArray<{ x: number; y: number; z?: number }>): string {
    if (!points.length) return "empty";
    const loop = startAtPosteriorHeel(ensureCcw(points.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }))));
    const h = createHash("sha256");
    h.update(String(loop.length));
    for (const p of loop) {
        h.update(`${p.x.toFixed(6)},${p.y.toFixed(6)};`);
    }
    return h.digest("hex");
}

export function shippedSampleTopPattern(): PolyPoint[] {
    return data().samples.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
}

export function shippedSampleTopControls(): PolyPoint[] {
    return data().controls.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
}

export function shippedPatternHash(): string {
    return data().patternHash;
}

export function shippedRimHash(): string {
    return data().rimHash;
}

export function shippedStyleMetrics(): Record<"straight" | "round" | "hybrid", ShippedStyleMetrics> {
    cachedMetrics ??= loadMetrics();
    return cachedMetrics;
}

/** True when this rim is the frozen SAMPLE_Top Full Contact source. */
export function rimMatchesShippedSampleTop(rim: ReadonlyArray<{ x: number; y: number }>): boolean {
    return hashClosedLoop(rim) === data().rimHash;
}

export function assertShippedPatternUntouched(): void {
    const live = hashClosedLoop(data().samples);
    if (live !== data().patternHash) {
        throw new Error(
            `[SHIPPED-PATTERN] hash ${live} != frozen ${data().patternHash} (source ${data().sourceSha})`,
        );
    }
    if (data().sourceSha !== SHIPPED_PATTERN_SOURCE_SHA) {
        throw new Error(`[SHIPPED-PATTERN] sourceSha ${data().sourceSha} != ${SHIPPED_PATTERN_SOURCE_SHA}`);
    }
}
