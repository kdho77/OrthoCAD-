import type { PlacedElement, Side, SideCorrections } from "@/types";
import { elementHeightAt } from "@/lib/geometry/elements";

// Shared parametric height field for insole surfaces. Used by both the procedural
// Three.js mesher and the OpenCascade solid builder so corrections stay aligned.

export interface HeightFieldParams {
    side: Side;
    lengthMm: number;
    widthMm: number;
    thicknessMm: number;
    corrections: SideCorrections;
    elements?: PlacedElement[];
    /** When false, skives are omitted (applied later as OCCT boolean cuts). */
    includeSkives?: boolean;
    /** When false, elements are omitted (applied later as OCCT booleans). */
    includeElements?: boolean;
}

const DEG = Math.PI / 180;

/** Smooth bump centered at `c` with radius `r`. Returns 0..1. */
export function bump(t: number, c: number, r: number): number {
    const d = Math.abs(t - c) / r;
    if (d >= 1) return 0;
    return 0.5 * (1 + Math.cos(Math.PI * d));
}

/** Outline half-width (0..1) as a function of normalized length u (0 heel → 1 toe). */
export function outlineHalfWidth(u: number): number {
    const heel = 0.55 + 0.25 * bump(u, 0.08, 0.18);
    const waist = 0.78 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.05));
    const toe = u > 0.88 ? Math.max(0.45, 1 - (u - 0.88) / 0.12) : 1;
    return Math.min(1, heel * waist) * (0.4 + 0.6 * toe);
}

/** Surface height in mm at normalized footprint coordinates (u along length, vSigned across width). */
export function heightAt(u: number, vSigned: number, params: HeightFieldParams): number {
    const { side, lengthMm, widthMm, thicknessMm, corrections: c, elements = [] } = params;
    const halfW = widthMm / 2;
    const medialSign = side === "left" ? -1 : 1;
    const av = Math.abs(vSigned);
    const medial = vSigned * medialSign < 0;
    let h = thicknessMm;

    const apexCenter = 0.42 + c.apexMoveMm / lengthMm;
    const arch = bump(u, apexCenter, 0.32);
    if (medial) h += (c.archHeightMm + c.archFillMm) * arch * (0.4 + 0.6 * av);

    const heel = bump(u, 0.1, 0.16);
    h += c.heelCupHeightMm * heel * Math.pow(av, 1.5);
    h += c.heelCupDepthMm * heel * (1 - av) * 0.5;

    h += Math.tan(c.rearfootPostingDeg * DEG) * (vSigned * medialSign) * halfW * heel;

    const fore = bump(u, 0.82, 0.22);
    h += Math.tan(c.forefootPostingDeg * DEG) * (vSigned * medialSign) * halfW * fore;

    const includeSkives = params.includeSkives ?? true;
    if (includeSkives) {
        if (medial) h -= c.medialSkiveMm * heel * av;
        else h -= c.lateralSkiveMm * heel * av;
    }

    const edge = Math.max(0, (av - 0.6) / 0.4);
    const flangeRegion = bump(u, 0.45, 0.4);
    h += (medial ? c.medialFlangeMm : c.lateralFlangeMm) * flangeRegion * edge;

    const includeElements = params.includeElements ?? true;
    if (includeElements) {
        const hw = outlineHalfWidth(u) * halfW;
        h += elementHeightAt(elements, u * lengthMm, vSigned * hw, lengthMm);
    }

    return Math.max(0.8, h);
}

export interface GridPoint {
    x: number;
    y: number;
    z: number;
}

export interface InsoleGrid {
    nx: number;
    ny: number;
    top: GridPoint[][];
    bottom: GridPoint[][];
}

/** Samples the correction surface on the footprint grid (no skives/elements when building OCCT base). */
export function sampleInsoleGrid(params: HeightFieldParams, nx = 48, ny = 24): InsoleGrid {
    const { lengthMm, widthMm } = params;
    const halfW = widthMm / 2;
    const top: GridPoint[][] = [];
    const bottom: GridPoint[][] = [];

    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const hw = outlineHalfWidth(u) * halfW;
        const topRow: GridPoint[] = [];
        const bottomRow: GridPoint[] = [];
        for (let j = 0; j <= ny; j++) {
            const vSigned = (j / ny) * 2 - 1;
            const x = u * lengthMm;
            const y = vSigned * hw;
            topRow.push({ x, y, z: heightAt(u, vSigned, params) });
            bottomRow.push({ x, y, z: 0 });
        }
        top.push(topRow);
        bottom.push(bottomRow);
    }

    return { nx, ny, top, bottom };
}
