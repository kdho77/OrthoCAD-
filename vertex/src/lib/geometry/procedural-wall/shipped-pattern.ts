// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import patternBaseline from "./baselines/sample-top-full-contact.json";
import styleMetricsBaseline from "./baselines/sample-top-style-metrics.json";
import { ensureCcw, type PolyPoint, startAtPosteriorHeel } from "./curves";
import { sha256Hex } from "./sha256";

export const SHIPPED_PATTERN_SOURCE_SHA = "a2f7cc61bd6242d45f302342addfac35be87aa83";
export const SHIPPED_PATTERN_JSON = "sample-top-full-contact.json";
export const SHIPPED_STYLE_METRICS_JSON = "sample-top-style-metrics.json";
/** Soft-metric ratchet vs the frozen a2f7cc61 SAMPLE_Top styles. */
export const SHIPPED_RATCHET_DEG = 0.5;
/** Hausdorff of the shipped pattern to the scaled DXF trace. */
export const SHIPPED_PATTERN_HAUSDORFF_MM = 1.5;
/** Windows Full Contact fit: lateral midfoot waist is a real feature. */
export const SHIPPED_MAX_INFLECTIONS = 4;
export const SHIPPED_LATERAL_K_ABS = 0.015;
export const SHIPPED_PATTERN_MAX_DKDS = 0.045;
export const SHIPPED_LATERAL_WAIST_U0 = 0.22;
export const SHIPPED_LATERAL_WAIST_U1 = 0.65;
/** SHA-256 of the frozen CCW posterior-heel control loop (a2f7cc61). */
export const SHIPPED_CONTROL_HASH = "2b51e5eda4c9e30abea976d9535c3f80ca159f048f809a439de8b3d64041012d";

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

let cachedPattern: ShippedPatternBaseline | null = null;
let cachedMetrics: Record<"straight" | "round" | "hybrid", ShippedStyleMetrics> | null = null;
let cachedControlHash = "";

function data(): ShippedPatternBaseline {
    cachedPattern ??= patternBaseline as ShippedPatternBaseline;
    return cachedPattern;
}

export function hashClosedLoop(points: ReadonlyArray<{ x: number; y: number; z?: number }>): string {
    if (!points.length) return "empty";
    const loop = startAtPosteriorHeel(ensureCcw(points.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }))));
    let payload = String(loop.length);
    for (const p of loop) {
        payload += `${p.x.toFixed(6)},${p.y.toFixed(6)};`;
    }
    return sha256Hex(payload);
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

export function shippedControlHash(): string {
    cachedControlHash ||= hashClosedLoop(data().controls);
    return cachedControlHash;
}

export function shippedStyleMetrics(): Record<"straight" | "round" | "hybrid", ShippedStyleMetrics> {
    cachedMetrics ??= styleMetricsBaseline as Record<"straight" | "round" | "hybrid", ShippedStyleMetrics>;
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
    const liveControls = shippedControlHash();
    if (SHIPPED_CONTROL_HASH && liveControls !== SHIPPED_CONTROL_HASH) {
        throw new Error(`[SHIPPED-PATTERN] control hash ${liveControls} != frozen ${SHIPPED_CONTROL_HASH}`);
    }
    if (data().sourceSha !== SHIPPED_PATTERN_SOURCE_SHA) {
        throw new Error(`[SHIPPED-PATTERN] sourceSha ${data().sourceSha} != ${SHIPPED_PATTERN_SOURCE_SHA}`);
    }
}
