// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PlacedElement, Side, SideCorrections } from "@/types";
import { heightAt, type HeightFieldParams } from "./height-field";

/**
 * Phase 4 — Clinical depth: Operator Graph.
 *
 * A clinical insole is no longer a bag of independent scalar corrections.
 * It is a (mostly) linear sequence of composable operators that each contribute
 * a displacement field. The graph is:
 *  - Inspectable and serializable (audit trail, prescription replay).
 *  - Regional (operators can target arch-only, medial column, etc.).
 *  - Future-extensible (add "tissue relief", "dynamic posting", "custom height map").
 *
 * For Phase 4 we keep the *existing* flat SideCorrections as the "legacy" source
 * and provide a bidirectional translation:
 *   legacy corrections → canonical operator list (one operator per correction kind)
 *   graph evaluation → delta height (added to or replacing parts of heightAt)
 *
 * The long-term vision (Phase 4/5) is that the DesignState stores the graph,
 * the flat corrections become a "summary" or "last applied preset", and the UI
 * (and AI) edit the graph.
 */

export type OperatorKind =
    | "arch_dome"
    | "arch_fill"
    | "heel_cup"
    | "rearfoot_posting"
    | "forefoot_posting"
    | "medial_skive"
    | "lateral_skive"
    | "medial_flange"
    | "lateral_flange"
    | "apex_move"
    | "element_add"
    | "regional_blend"
    | "tissue_relief"
    | "sta_posting"; // STA-aware variant of posting

export interface RegionMask {
    id: string;
    /** 0..1 weight at (u, vSigned). Simple analytic masks for 4/5; later user-editable. */
    weightAt: (u: number, vSigned: number) => number;
}

export const DEFAULT_REGIONS: Record<string, RegionMask> = {
    full: { id: "full", weightAt: () => 1 },
    medial: { id: "medial", weightAt: (_u, v) => Math.max(0, -v) },
    lateral: { id: "lateral", weightAt: (_u, v) => Math.max(0, v) },
    arch: {
        id: "arch",
        weightAt: (u, v) => {
            const archBand = u > 0.22 && u < 0.62 ? 1 : 0.2;
            return archBand * Math.max(0, -v) * 0.9;
        },
    },
    heel: { id: "heel", weightAt: (u) => (u < 0.28 ? 1 : 0.1) },
    forefoot: { id: "forefoot", weightAt: (u) => (u > 0.58 ? 1 : 0.1) },
};

export interface ClinicalOperator {
    id: string;
    kind: OperatorKind;
    enabled: boolean;
    /** Kind-specific parameters (numbers in mm or deg as appropriate). */
    params: Record<string, number | string | boolean>;
    /** Which region mask to multiply this operator's contribution by. */
    regionId?: string;
    /** Optional human label for audit / prescription trace. */
    label?: string;
}

export interface OperatorGraph {
    version: 1;
    side: Side;
    lengthMm: number;
    widthMm: number;
    /** Ordered list — later operators can see the cumulative field if needed (for now additive only). */
    operators: ClinicalOperator[];
    /** Optional biomechanical context for STA-aware and stress operators. */
    biomech?: {
        staInclinationDeg?: number; // positive = varus or per clinic convention
        staAxisAzimuthDeg?: number;
    };
}

/** Convert the legacy flat corrections into a canonical operator list (Phase 4 compat). */
export function correctionsToOperators(c: SideCorrections, side: Side): ClinicalOperator[] {
    const ops: ClinicalOperator[] = [];
    const push = (kind: OperatorKind, params: Record<string, number>) =>
        ops.push({ id: `legacy_${kind}`, kind, enabled: true, params, label: `legacy ${kind}` });

    if (c.archHeightMm) push("arch_dome", { height: c.archHeightMm });
    if (c.archFillMm) push("arch_fill", { height: c.archFillMm });
    if (c.heelCupHeightMm || c.heelCupDepthMm) {
        push("heel_cup", { height: c.heelCupHeightMm, depth: c.heelCupDepthMm });
    }
    if (c.rearfootPostingDeg) push("rearfoot_posting", { deg: c.rearfootPostingDeg });
    if (c.forefootPostingDeg) push("forefoot_posting", { deg: c.forefootPostingDeg });
    if (c.medialSkiveMm) push("medial_skive", { mm: c.medialSkiveMm });
    if (c.lateralSkiveMm) push("lateral_skive", { mm: c.lateralSkiveMm });
    if (c.medialFlangeMm) push("medial_flange", { mm: c.medialFlangeMm });
    if (c.lateralFlangeMm) push("lateral_flange", { mm: c.lateralFlangeMm });
    if (c.apexMoveMm) push("apex_move", { mm: c.apexMoveMm });

    return ops;
}

/** Evaluate a single operator's contribution (mm) at a footprint coordinate. */
export function evaluateOperator(
    op: ClinicalOperator,
    u: number,
    vSigned: number,
    ctx: { lengthMm: number; widthMm: number; side: Side; biomech?: OperatorGraph["biomech"] },
): number {
    if (!op.enabled) return 0;
    const w = DEFAULT_REGIONS[op.regionId ?? "full"]?.weightAt(u, vSigned) ?? 1;
    const p = op.params;

    switch (op.kind) {
        case "arch_dome":
        case "arch_fill": {
            const h = (p.height as number) || 0;
            // Reuse a bump similar to the classic height field but regional.
            const centerU = 0.42;
            const r = 0.22;
            const d = Math.abs(u - centerU) / r;
            const bump = d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * d));
            return h * bump * w;
        }
        case "heel_cup": {
            const depth = (p.depth as number) || 0;
            const h = (p.height as number) || 0;
            const rear = Math.max(0, 0.28 - u) / 0.28;
            return (h - depth) * rear * w;
        }
        case "rearfoot_posting":
        case "forefoot_posting": {
            const deg = (p.deg as number) || 0;
            const isRear = op.kind === "rearfoot_posting";
            const zone = isRear ? Math.max(0, 0.32 - u) / 0.32 : Math.max(0, u - 0.58) / 0.42;
            // STA-aware rotation approximation (Phase 4):
            // If STA inclination is known, the effective frontal tilt is modulated.
            // Here we apply a simple scalar; a true 3D rotation around STJ would
            // be done in the OCCT solid or a 3D displacement field.
            const sta = ctx.biomech?.staInclinationDeg ?? 0;
            const staFactor = 1.0 + (sta / 45) * 0.15; // small coupling
            const tiltMm = (deg * 0.18) * staFactor; // approx mm per deg at edge
            return tiltMm * zone * w;
        }
        case "medial_skive":
        case "lateral_skive": {
            // Kirby raise model (replaces the clinically inverted subtractive op).
            // Approximate plane-max raise: full depth near the skived edge in the
            // heel, tapering across to the opposite edge. Exact plane∩bowl lives
            // in heel-skive.ts for the base / heightAt paths.
            const mm = (p.mm as number) || 0;
            const isMedial = op.kind === "medial_skive";
            const medialSign = ctx.side === "left" ? -1 : 1;
            const m = -(vSigned * medialSign); // +1 medial
            const edge = isMedial ? Math.max(0, m) : Math.max(0, -m);
            const rear = Math.max(0, 0.28 - u) / 0.28;
            return mm * edge * rear * w; // RAISE (+Z)
        }
        case "medial_flange":
        case "lateral_flange": {
            const mm = (p.mm as number) || 0;
            const isMedial = op.kind === "medial_flange";
            const sign = isMedial ? -1 : 1;
            const edge = Math.max(0, sign * vSigned);
            return mm * edge * w;
        }
        case "apex_move": {
            // Simple longitudinal shift of the arch apex contribution.
            const mm = (p.mm as number) || 0;
            const shiftU = mm / (ctx.lengthMm || 260);
            const shiftedU = u - shiftU;
            const d = Math.abs(shiftedU - 0.42) / 0.22;
            const bump = d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * d));
            return 4 * bump * w; // small coupling to existing dome
        }
        case "sta_posting": {
            // Explicit STA-aware posting operator (preferred over legacy when present).
            const deg = (p.deg as number) || 0;
            const zone = Math.max(0, 0.32 - u) / 0.32;
            const sta = ctx.biomech?.staInclinationDeg ?? 0;
            // The posting plane is rotated around the STJ axis; we approximate
            // the vertical effect as a combination of frontal + small transverse.
            const effective = deg * (1 + Math.abs(sta) / 60);
            return (effective * 0.16) * zone * w;
        }
        case "element_add":
        case "regional_blend":
        case "tissue_relief":
            // These are either handled by the classic element pipeline or by later
            // hybrid rebuild passes. Return 0 here; the graph executor can special-case.
            return 0;
        default:
            return 0;
    }
}

/** Sum the graph contributions at a point (the "delta" the graph adds on top of neutral/base). */
export function evaluateGraph(graph: OperatorGraph, u: number, vSigned: number): number {
    let total = 0;
    for (const op of graph.operators) {
        total += evaluateOperator(op, u, vSigned, {
            lengthMm: graph.lengthMm,
            widthMm: graph.widthMm,
            side: graph.side,
            biomech: graph.biomech,
        });
    }
    return total;
}

/**
 * Hybrid top rebuild hook (Phase 4 sketch).
 * When a base + graph are both present, the final top at a point can be:
 *   baseTop(u,v) + evaluateGraph(...) * regionalTopFactor(u,v)
 * The caller (height field or OCCT loft) decides the blending weight.
 */
export function hybridTopHeight(
    baseHeight: number,
    graphDelta: number,
    topFactor: number, // 0 bottom ... 1 top (from BaseBounds classification)
): number {
    // Graph corrections only meaningfully affect the top sheet and walls.
    return baseHeight + graphDelta * Math.max(0, topFactor);
}

/** Tissue stress heuristic (very approximate). Higher → more likely to need relief. */
export function estimateTissueStress(
    u: number,
    vSigned: number,
    totalHeight: number,
    corrections: SideCorrections,
    elements: PlacedElement[],
): number {
    // Base pressure proxy: taller + aggressive arch/heel cup + posting + pads near the point.
    let stress = Math.max(0, totalHeight - 3) * 0.6;
    stress += Math.abs(corrections.archHeightMm) * 0.25;
    stress += Math.abs(corrections.heelCupDepthMm) * 0.2;
    stress += Math.abs(corrections.rearfootPostingDeg) * 0.15;

    // Local element contribution.
    for (const el of elements) {
        const dx = (el.position.x / 260) - u;
        const dy = el.position.y - vSigned * 50; // rough
        const d = Math.hypot(dx * 260, dy);
        if (d < 25) stress += (el.heightMm || 4) * 0.8 * (1 - d / 25);
    }
    return Math.max(0, Math.min(10, stress));
}
