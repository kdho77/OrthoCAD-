import type { BufferGeometry } from "three";
import { buildInsoleGeometry, type InsoleParams } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import type { SolidValidation } from "@/lib/geometry/repair";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

export interface SolidResult {
    geometry: BufferGeometry;
    manifold: SolidValidation;
}

// Geometry kernel abstraction — procedural Three.js fallback or OpenCascade WASM.
//
// Two tiers coexist behind one interface (see docs/hybrid-geometry-architecture.md):
//   - "preview"        fast procedural mesh, used for real-time editing.
//   - "authoritative"  watertight OCCT BRep solid, used on Confirm / Export.
// Callers branch on `tier` (not on `name`) when they need to know whether the
// kernel can produce a true manufacturing-grade solid.

export type GeometryTier = "preview" | "authoritative";

export interface IGeometryKernel {
    readonly name: string;
    readonly ready: boolean;
    /** Quality tier of geometry this kernel produces. */
    readonly tier: GeometryTier;

    buildInsole(params: InsoleParams): BufferGeometry;
    /** Builds the insole and reports whether the result is a watertight solid. */
    buildInsoleSolid(params: InsoleParams): SolidResult;
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
            manifold: { ...mesh, occtClosed: false, isWatertight: mesh.isWatertight },
        };
    }

    exportSTL(geometry: BufferGeometry): ArrayBuffer {
        return geometryToBinarySTL(geometry);
    }
}

let kernel: IGeometryKernel = new ThreeKernel();
let occtLoadAttempted = false;

export function getKernel(): IGeometryKernel {
    return kernel;
}

/** True when the active kernel can produce authoritative (watertight OCCT) solids. */
export function isAuthoritativeKernel(): boolean {
    return kernel.tier === "authoritative";
}

/**
 * Attempts to load the Chili3D OpenCascade WASM kernel. Resolves to `true` when
 * the OCCT kernel is active, `false` when falling back to the procedural kernel.
 */
export async function loadOcctKernel(): Promise<boolean> {
    if (occtLoadAttempted) return kernel.name !== "three-procedural";
    occtLoadAttempted = true;

    const { useKernelStore } = await import("@/stores/kernel-store");
    const { setLoadState, notifyKernelChanged } = useKernelStore.getState();
    setLoadState("loading");

    try {
        const { initVertexOcct } = await import("@/lib/chili3d/occt-loader");
        const { OcctKernel } = await import("@/lib/chili3d/occt-kernel");
        await initVertexOcct();
        kernel = new OcctKernel();
        notifyKernelChanged("opencascade-wasm");
        setLoadState("ready");
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[loadOcctKernel] WASM unavailable, using procedural kernel:", error);
        kernel = new ThreeKernel();
        notifyKernelChanged("three-procedural");
        setLoadState("failed", message);
        return false;
    }
}
