import type { BufferGeometry } from "three";
import { buildInsoleGeometry, type InsoleParams } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import type { SolidValidation } from "@/lib/geometry/repair";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { useKernelStore } from "@/stores/kernel-store";

export interface SolidResult {
    geometry: BufferGeometry;
    manifold: SolidValidation;
}

// Geometry kernel abstraction — procedural Three.js fallback or OpenCascade WASM.

export interface IGeometryKernel {
    readonly name: string;
    readonly ready: boolean;

    buildInsole(params: InsoleParams): BufferGeometry;
    /** Builds the insole and reports whether the result is a watertight solid. */
    buildInsoleSolid(params: InsoleParams): SolidResult;
    exportSTL(geometry: BufferGeometry): ArrayBuffer;
}

class ThreeKernel implements IGeometryKernel {
    readonly name = "three-procedural";
    readonly ready = true;

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

/**
 * Attempts to load the Chili3D OpenCascade WASM kernel. Resolves to `true` when
 * the OCCT kernel is active, `false` when falling back to the procedural kernel.
 */
export async function loadOcctKernel(): Promise<boolean> {
    if (occtLoadAttempted) return kernel.name !== "three-procedural";
    occtLoadAttempted = true;

    const { setLoadState, notifyKernelChanged } = useKernelStore.getState();
    setLoadState("loading");

    try {
        const { initVertexOcct } = await import("@/lib/chili3d/occt-loader");
        const { OcctKernel } = await import("@/lib/chili3d/occt-kernel");
        await initVertexOcct();
        kernel = new OcctKernel();
        notifyKernelChanged();
        setLoadState("ready");
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[loadOcctKernel] WASM unavailable, using procedural kernel:", error);
        kernel = new ThreeKernel();
        setLoadState("failed", message);
        return false;
    }
}
