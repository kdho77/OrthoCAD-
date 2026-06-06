import type { BufferGeometry } from "three";
import { buildInsoleGeometry, type InsoleParams } from "@/lib/geometry/insole";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

// Geometry kernel abstraction.
//
// Phase 0 ships a Three.js-backed kernel that produces parametric insole meshes
// and exports binary STL. The interface is designed so a forked Chili3D /
// OpenCascade (OCCT) WASM kernel can be dropped in later for watertight solids,
// boolean operations and shelling without touching the UI or stores.

export interface IGeometryKernel {
    readonly name: string;
    readonly ready: boolean;

    buildInsole(params: InsoleParams): BufferGeometry;
    exportSTL(geometry: BufferGeometry): ArrayBuffer;
}

class ThreeKernel implements IGeometryKernel {
    readonly name = "three-procedural";
    readonly ready = true;

    buildInsole(params: InsoleParams): BufferGeometry {
        return buildInsoleGeometry(params);
    }

    exportSTL(geometry: BufferGeometry): ArrayBuffer {
        return geometryToBinarySTL(geometry);
    }
}

let kernel: IGeometryKernel = new ThreeKernel();

export function getKernel(): IGeometryKernel {
    return kernel;
}

/**
 * Attempts to load the Chili3D OpenCascade WASM kernel. Resolves to `true` when
 * the OCCT kernel is active, `false` when falling back to the procedural kernel.
 *
 * The OCCT kernel build is integrated in a later phase; this loader keeps the
 * call-site stable so swapping in the real kernel requires no UI changes.
 */
export async function loadOcctKernel(): Promise<boolean> {
    try {
        // Dynamic import is intentionally guarded: the WASM package may not be
        // built/available in every environment (CI, preview, tests).
        // const { initWasm } = await import("@chili3d/wasm");
        // await initWasm();
        // kernel = new OcctKernel();
        // return true;
        return false;
    } catch {
        kernel = new ThreeKernel();
        return false;
    }
}
