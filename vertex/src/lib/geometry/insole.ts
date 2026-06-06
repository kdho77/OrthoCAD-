import { BufferAttribute, BufferGeometry } from "three";
import type { Side, SideCorrections } from "@/types";

// Generates a parametric orthotic insole mesh from correction parameters.
// This is a procedural heightmap shell sufficient for the Phase 0/1 viewer and
// STL export; in later phases the watertight solid is produced by the Chili3D
// OpenCascade kernel for medical-grade booleans and shelling.

export interface InsoleParams {
    side: Side;
    lengthMm: number; // heel-to-toe
    widthMm: number; // medial-lateral
    thicknessMm: number;
    corrections: SideCorrections;
    /** Mesh resolution along length / width. */
    segmentsX?: number;
    segmentsY?: number;
}

const DEG = Math.PI / 180;

/** Smooth bump centered at `c` with radius `r`. Returns 0..1. */
function bump(t: number, c: number, r: number): number {
    const d = Math.abs(t - c) / r;
    if (d >= 1) return 0;
    return 0.5 * (1 + Math.cos(Math.PI * d));
}

/** Outline half-width (0..1) as a function of normalized length u (0 heel → 1 toe). */
function outlineHalfWidth(u: number): number {
    // Narrow heel, wide forefoot, rounded toe — classic insole footprint.
    const heel = 0.55 + 0.25 * bump(u, 0.08, 0.18);
    const waist = 0.78 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.05));
    // Rounded toe — taper but never pinch to zero width (keeps the solid watertight).
    const toe = u > 0.88 ? Math.max(0.45, 1 - (u - 0.88) / 0.12) : 1;
    return Math.min(1, heel * waist) * (0.4 + 0.6 * toe);
}

export function buildInsoleGeometry(params: InsoleParams): BufferGeometry {
    const {
        side,
        lengthMm,
        widthMm,
        thicknessMm,
        corrections: c,
        segmentsX = 80,
        segmentsY = 40,
    } = params;

    const nx = segmentsX;
    const ny = segmentsY;
    const halfW = widthMm / 2;

    // Medial sign: +1 toward medial (arch) side. Mirror for right foot.
    const medialSign = side === "left" ? -1 : 1;

    const heightAt = (u: number, vSigned: number): number => {
        // vSigned in [-1, 1], positive toward lateral.
        const medial = vSigned * medialSign < 0; // medial side
        let h = thicknessMm;

        // Medial longitudinal arch — peaks around midfoot.
        const arch = bump(u, 0.42, 0.32);
        if (medial) h += (c.archHeightMm + c.archFillMm) * arch * (0.4 + 0.6 * Math.abs(vSigned));

        // Heel cup — raised rim around the heel.
        const heel = bump(u, 0.1, 0.16);
        h += c.heelCupHeightMm * heel * Math.pow(Math.abs(vSigned), 1.5);
        h += c.heelCupDepthMm * heel * (1 - Math.abs(vSigned)) * 0.5;

        // Rearfoot posting (varus/valgus wedge) — linear across width at the heel.
        h += Math.tan(c.rearfootPostingDeg * DEG) * (vSigned * medialSign) * halfW * heel;

        // Forefoot posting — linear wedge under the forefoot.
        const fore = bump(u, 0.82, 0.22);
        h += Math.tan(c.forefootPostingDeg * DEG) * (vSigned * medialSign) * halfW * fore;

        // Skives carve material from heel medial/lateral.
        if (medial) h -= c.medialSkiveMm * heel * Math.abs(vSigned);
        else h -= c.lateralSkiveMm * heel * Math.abs(vSigned);

        return Math.max(0.8, h);
    };

    // Build top + bottom surfaces over the footprint outline.
    const positions: number[] = [];
    const grid: number[][] = []; // vertex indices for the top surface
    let vIndex = 0;

    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const hw = outlineHalfWidth(u) * halfW;
        const row: number[] = [];
        for (let j = 0; j <= ny; j++) {
            const vSigned = (j / ny) * 2 - 1;
            const x = u * lengthMm;
            const y = vSigned * hw;
            const z = heightAt(u, vSigned);
            positions.push(x, y, z);
            row.push(vIndex++);
        }
        grid.push(row);
    }

    // Bottom surface (flat at z=0) mirrors the top grid.
    const bottomGrid: number[][] = [];
    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const hw = outlineHalfWidth(u) * halfW;
        const row: number[] = [];
        for (let j = 0; j <= ny; j++) {
            const vSigned = (j / ny) * 2 - 1;
            positions.push(u * lengthMm, vSigned * hw, 0);
            row.push(vIndex++);
        }
        bottomGrid.push(row);
    }

    const indices: number[] = [];
    const quad = (a: number, b: number, cc: number, d: number) => {
        indices.push(a, b, cc, a, cc, d);
    };

    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            // top
            quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
            // bottom (reversed winding)
            quad(bottomGrid[i][j], bottomGrid[i + 1][j], bottomGrid[i + 1][j + 1], bottomGrid[i][j + 1]);
        }
    }

    // Side walls around the perimeter.
    for (let i = 0; i < nx; i++) {
        // medial/lateral edges (j = 0 and j = ny)
        quad(grid[i][0], grid[i + 1][0], bottomGrid[i + 1][0], bottomGrid[i][0]);
        quad(grid[i][ny], bottomGrid[i][ny], bottomGrid[i + 1][ny], grid[i + 1][ny]);
    }
    for (let j = 0; j < ny; j++) {
        // heel and toe caps (i = 0 and i = nx)
        quad(grid[0][j], bottomGrid[0][j], bottomGrid[0][j + 1], grid[0][j + 1]);
        quad(grid[nx][j], grid[nx][j + 1], bottomGrid[nx][j + 1], bottomGrid[nx][j]);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}
