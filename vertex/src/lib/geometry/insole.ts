import { BufferAttribute, BufferGeometry } from "three";
import { type HeightFieldParams, heightAt, resolveOutlineHalfWidth } from "@/lib/geometry/height-field";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import type {
    PlacedElement,
    ProductionMethod,
    ShellThicknessMode,
    Side,
    SideCorrections,
    SideShapeFinish,
} from "@/types";

// Generates a parametric orthotic insole mesh from correction parameters.
// Procedural fallback when the OpenCascade WASM kernel is unavailable.

export interface InsoleParams {
    side: Side;
    lengthMm: number;
    widthMm: number;
    thicknessMm: number;
    corrections: SideCorrections;
    elements?: PlacedElement[];
    segmentsX?: number;
    segmentsY?: number;
    /** Production method — `printing_shell` triggers OCCT wall shelling when WASM is active. */
    method?: ProductionMethod;
    /** User-edited perimeter override for this side. */
    trimline?: TrimlineCurve | null;
    /**
     * When true (OCCT only), apply the trimline as a clean boolean cut on top of
     * the lofted base instead of relying solely on per-station width sampling.
     * Reserved for Confirm / Export; falls back to the lofted footprint on error.
     */
    useBooleanTrimline?: boolean;
    shellThicknessMode?: ShellThicknessMode;
    shellThicknessRfMm?: number;
    shellThicknessMfMm?: number;
    shellThicknessFfMm?: number;
    shellThicknessBlendMm?: number;
    shapeFinish?: SideShapeFinish | null;
}

export function buildInsoleGeometry(params: InsoleParams): BufferGeometry {
    const {
        side,
        lengthMm,
        widthMm,
        thicknessMm,
        corrections,
        elements = [],
        segmentsX = 96,
        segmentsY = 48,
        trimline = null,
        shellThicknessMode,
        shellThicknessRfMm,
        shellThicknessMfMm,
        shellThicknessFfMm,
        shellThicknessBlendMm,
        method,
        shapeFinish = null,
    } = params;

    const field: HeightFieldParams = {
        side,
        lengthMm,
        widthMm,
        thicknessMm,
        corrections,
        elements,
        includeSkives: true,
        includeElements: true,
        trimline,
        shellThicknessMode,
        shellThicknessRfMm,
        shellThicknessMfMm,
        shellThicknessFfMm,
        shellThicknessBlendMm,
        method,
        shapeFinish,
    };

    const nx = segmentsX;
    const ny = segmentsY;
    const halfW = widthMm / 2;

    const positions: number[] = [];
    const grid: number[][] = [];
    let vIndex = 0;

    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const hw = resolveOutlineHalfWidth(u, field) * halfW;
        const row: number[] = [];
        for (let j = 0; j <= ny; j++) {
            const vSigned = -1 + (2 * j) / ny;
            const y = vSigned * hw;
            const z = heightAt(u, vSigned, field);
            positions.push(u * lengthMm, y, z);
            row.push(vIndex++);
        }
        grid.push(row);
    }

    const indices: number[] = [];
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const a = grid[i][j];
            const b = grid[i + 1][j];
            const c = grid[i][j + 1];
            const d = grid[i + 1][j + 1];
            indices.push(a, b, c, b, d, c);
        }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}
