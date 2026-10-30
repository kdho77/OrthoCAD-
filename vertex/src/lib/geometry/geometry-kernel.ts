// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { BufferGeometry } from "three";
import { modifiedBaseResult } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { buildInsoleGeometry, type InsoleParams } from "@/lib/geometry/insole";
import { analyzeManifold, type ManifoldReport } from "@/lib/geometry/manifold";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

/**
 * Mesh manifold report plus a reserved closed-solid flag for future kernels.
 * The procedural kernel always leaves `solidClosed` false.
 */
export interface SolidValidation extends ManifoldReport {
    solidClosed: boolean;
}

export interface SolidResult {
    geometry: BufferGeometry;
    manifold: SolidValidation;
}

// Neutral geometry kernel boundary.
//
// The shipping kernel is procedural Three.js ("preview"). `tier` is the hook a
// later authoritative kernel would use. This module does not load one.

export type GeometryTier = "preview" | "authoritative";

export interface IGeometryKernel {
    readonly name: string;
    readonly ready: boolean;
    /** Quality tier of geometry this kernel produces. */
    readonly tier: GeometryTier;

    buildInsole(params: InsoleParams): BufferGeometry;
    /** Builds the insole and reports whether the result is a watertight solid. */
    buildInsoleSolid(params: InsoleParams): SolidResult;
    /**
     * Apply design modifiers (corrections / elements) onto a base template mesh
     * (Base + Modifier model). Returns the modified geometry plus a manifold
     * report. `smoothingIterations` relaxes the displacement field for a smooth
     * top (0 = interactive, 1–2 = idle/export). See docs/base-modifier-architecture.md.
     */
    buildFromBase(base: BufferGeometry, field: HeightFieldParams, smoothingIterations?: number): SolidResult;
    exportSTL(geometry: BufferGeometry): ArrayBuffer;
}

class ThreeKernel implements IGeometryKernel {
    readonly name = "three-procedural";
    readonly ready = true;
    readonly tier: GeometryTier = "preview";

    buildInsole(params: InsoleParams): BufferGeometry {
        return buildInsoleGeometry(params);
    }

    buildInsoleSolid(params: InsoleParams): SolidResult {
        const geometry = buildInsoleGeometry(params);
        const mesh = analyzeManifold(geometry);
        return {
            geometry,
            manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight },
        };
    }

    buildFromBase(base: BufferGeometry, field: HeightFieldParams, smoothingIterations = 0): SolidResult {
        return modifiedBaseResult(base, field, smoothingIterations);
    }

    exportSTL(geometry: BufferGeometry): ArrayBuffer {
        return geometryToBinarySTL(geometry);
    }
}

const kernel: IGeometryKernel = new ThreeKernel();

export function getKernel(): IGeometryKernel {
    return kernel;
}

/** True when the active kernel's tier is authoritative. The procedural kernel is not. */
export function isAuthoritativeKernel(): boolean {
    return kernel.tier === "authoritative";
}
