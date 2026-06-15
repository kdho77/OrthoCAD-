import { shapesToStl, type IShape } from "@chili3d/core";
import { ShapeFactory } from "@chili3d/wasm";
import type { BufferGeometry } from "three";
import type { GeometryTier, IGeometryKernel, SolidResult } from "@/lib/chili3d/kernel";
import {
    applyBaseBooleansOnSewnSolid,
    applyRimBlend,
    applyThicknessToSewnBase,
    sewBufferGeometryToManufacturingStl,
    sewGlbGeometryToSolid,
} from "@/lib/geometry/base-occt";
import { modifiedBaseResult } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { buildInsoleGeometry, type InsoleParams } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { shapeToBufferGeometry } from "@/lib/geometry/mesh-bridge";
import { buildOcctInsoleSolid } from "@/lib/geometry/occt-insole";
import { repairOcctSolid } from "@/lib/geometry/repair";
import { validateSolid } from "@/lib/geometry/repair";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

const shapeByGeometry = new WeakMap<BufferGeometry, IShape>();

export class OcctKernel implements IGeometryKernel {
    readonly name = "opencascade-wasm";
    readonly ready = true;
    readonly tier: GeometryTier = "authoritative";

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

    /**
     * Phase 3B: Base path parity.
     * Attempt to sew the imported base GLB (multi-mesh tolerant via upstream merge)
     * into a real OCCT solid, then apply trimline/element/skive booleans directly
     * on it (exact BRep). On any failure we fall back to the proven deformation
     * result (never worse than before).
     *
     * The returned geometry is a tessellation of the (sewn + boolean) solid when
     * successful so that viewport and export stay consistent. The underlying shape
     * is cached for native STL export.
     */
    buildFromBase(base: BufferGeometry, field: HeightFieldParams, smoothingIterations = 0): SolidResult {
        // Always compute the deformation result first (fast, stable bottom guarantee,
        // and the universal fallback).
        const deform = modifiedBaseResult(base, field, smoothingIterations);

        // Only attempt the sewn authoritative path when we are the OCCT kernel and
        // the caller is asking for manufacturing quality (smoothingIterations >= 1
        // is a good signal for idle/export; we still try even on 0 for parity).
        try {
            const sewn = sewGlbGeometryToSolid(this.factory, base);
            if (!sewn) return deform;

            let solid = applyBaseBooleansOnSewnSolid(this.factory, sewn, field);

            // Rim blend (small, printable edge on the fresh cut perimeter).
            solid = applyRimBlend(this.factory, solid, 1.0);

            // Thickness / shell handling specific to the sewn base.
            // We read a conventional "method" off the field if present (the
            // HeightFieldParams is extended by callers for export); fall back
            // to solid.
            const method = (field as any).method as any;
            solid = applyThicknessToSewnBase(this.factory, solid, field.thicknessMm, method);

            // Final repair + tessellate for the result geometry.
            const repaired = repairOcctSolid(this.factory, solid);
            const geometry = shapeToBufferGeometry(repaired);
            shapeByGeometry.set(geometry, repaired);

            const manifold = validateSolid(repaired, geometry);
            // If the sewn path produced a worse manifold report than deformation,
            // prefer the deformation (defensive).
            if (!manifold.isWatertight && deform.manifold.isWatertight) {
                geometry.dispose();
                return deform;
            }

            return { geometry, manifold };
        } catch (err) {
            if (typeof console !== "undefined") {
                console.warn("[OcctKernel] sewn base path failed, using deformation fallback:", err);
            }
            return deform;
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

    /**
     * Manufacturing STL from raw imported GLB geometry (before mesh-close).
     * Uses sewGlbGeometryToSolid → base booleans → repair → shapesToStl.
     */
    exportManufacturingStlFromBase(base: BufferGeometry, field: HeightFieldParams): ArrayBuffer | null {
        try {
            const sewn = sewGlbGeometryToSolid(this.factory, base);
            if (!sewn) return null;

            let solid = applyBaseBooleansOnSewnSolid(this.factory, sewn, field);
            solid = applyRimBlend(this.factory, solid, 1.0);
            const method = (field as { method?: "printing_solid" | "printing_shell" | "milling_3axis" }).method;
            solid = applyThicknessToSewnBase(this.factory, solid, field.thicknessMm, method);
            const repaired = repairOcctSolid(this.factory, solid);
            const bytes = shapesToStl([repaired], { binary: true });
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } catch {
            return null;
        }
    }

    exportManufacturingStlFromLiveMesh(geometry: BufferGeometry): ArrayBuffer | null {
        return sewBufferGeometryToManufacturingStl(this.factory, geometry);
    }
}
