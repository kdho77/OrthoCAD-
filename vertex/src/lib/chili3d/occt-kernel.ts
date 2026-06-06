import { shapesToStl, type IShape } from "@chili3d/core";
import { ShapeFactory } from "@chili3d/wasm";
import type { BufferGeometry } from "three";
import type { IGeometryKernel, SolidResult } from "@/lib/chili3d/kernel";
import { buildInsoleGeometry, type InsoleParams } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { shapeToBufferGeometry } from "@/lib/geometry/mesh-bridge";
import { buildOcctInsoleSolid } from "@/lib/geometry/occt-insole";
import { validateSolid } from "@/lib/geometry/repair";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

const shapeByGeometry = new WeakMap<BufferGeometry, IShape>();

export class OcctKernel implements IGeometryKernel {
    readonly name = "opencascade-wasm";
    readonly ready = true;

    private readonly factory = new ShapeFactory();

    buildInsole(params: InsoleParams): BufferGeometry {
        return this.buildInsoleSolid(params).geometry;
    }

    buildInsoleSolid(params: InsoleParams): SolidResult {
        try {
            const solid = buildOcctInsoleSolid(this.factory, params);
            const geometry = shapeToBufferGeometry(solid);
            shapeByGeometry.set(geometry, solid);
            return { geometry, manifold: validateSolid(solid, geometry) };
        } catch (error) {
            console.warn("[OcctKernel] solid build failed, using procedural fallback:", error);
            const geometry = buildInsoleGeometry(params);
            const mesh = analyzeManifold(geometry);
            return {
                geometry,
                manifold: { ...mesh, occtClosed: false, isWatertight: mesh.isWatertight },
            };
        }
    }

    exportSTL(geometry: BufferGeometry): ArrayBuffer {
        const shape = shapeByGeometry.get(geometry);
        if (shape) {
            const bytes = shapesToStl([shape], { binary: true });
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        }
        return geometryToBinarySTL(geometry);
    }
}
