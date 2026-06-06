import { BufferAttribute, BufferGeometry } from "three";
import { heightAt, outlineHalfWidth, type HeightFieldParams } from "@/lib/geometry/height-field";
import type { PlacedElement, Side, SideCorrections } from "@/types";

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
    };

    const nx = segmentsX;
    const ny = segmentsY;
    const halfW = widthMm / 2;

    const positions: number[] = [];
    const grid: number[][] = [];
    let vIndex = 0;

    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const hw = outlineHalfWidth(u) * halfW;
        const row: number[] = [];
        for (let j = 0; j <= ny; j++) {
            const vSigned = (j / ny) * 2 - 1;
            const x = u * lengthMm;
            const y = vSigned * hw;
            const z = heightAt(u, vSigned, field);
            positions.push(x, y, z);
            row.push(vIndex++);
        }
        grid.push(row);
    }

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
            quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
            quad(bottomGrid[i][j], bottomGrid[i + 1][j], bottomGrid[i + 1][j + 1], bottomGrid[i][j + 1]);
        }
    }

    for (let i = 0; i < nx; i++) {
        quad(grid[i][0], grid[i + 1][0], bottomGrid[i + 1][0], bottomGrid[i][0]);
        quad(grid[i][ny], bottomGrid[i][ny], bottomGrid[i + 1][ny], grid[i + 1][ny]);
    }
    for (let j = 0; j < ny; j++) {
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
