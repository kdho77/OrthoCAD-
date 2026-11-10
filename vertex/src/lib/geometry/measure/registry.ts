// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { useMeasureStore } from "@/stores/measure-store";
import { nearestSurfacePoint, triangleMeshFromGeometry } from "./mesh-ops";
import type { MeasureProduct, MeasureSide } from "./types";

/** A point that moves farther than this on rebuild is cleared instead of slid. */
export const REPROJECT_CLEAR_MM = 5;

export interface PublishedSolid {
    id: string;
    product: MeasureProduct;
    side: MeasureSide;
    geometry: BufferGeometry;
}

const solids = new Map<string, PublishedSolid>();
const hashes = new Map<string, string>();
let version = 0;
let snapshot: PublishedSolid[] = [];
let snapshotVersion = -1;
const listeners = new Set<() => void>();

function geometryHash(geometry: BufferGeometry): string {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count === 0) return "0";
    const mid = Math.min(pos.count - 1, 17);
    return [
        pos.count,
        pos.getX(0).toFixed(3),
        pos.getY(mid).toFixed(3),
        pos.getZ(pos.count - 1).toFixed(3),
    ].join(":");
}

function emit(): void {
    version += 1;
    for (const listener of listeners) listener();
}

export function subscribeMeasureRegistry(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getMeasureSolidsSnapshot(): PublishedSolid[] {
    if (snapshotVersion !== version) {
        snapshot = [...solids.values()];
        snapshotVersion = version;
    }
    return snapshot;
}

/**
 * Register the solid the viewer is drawing. Vertices stay in the export frame;
 * the Object3D pose is the display transform and is not copied here.
 * A changed hash reprojects stored points onto the new surface, or clears them.
 */
export function publishMeasureSolid(solid: PublishedSolid): () => void {
    const nextHash = geometryHash(solid.geometry);
    const previous = hashes.get(solid.id);
    solids.set(solid.id, solid);
    hashes.set(solid.id, nextHash);
    if (previous != null && previous !== nextHash) {
        reprojectStoredPoints(solid.id, solid.geometry);
    }
    emit();
    return () => {
        if (solids.get(solid.id)?.geometry !== solid.geometry) return;
        solids.delete(solid.id);
        hashes.delete(solid.id);
        emit();
    };
}

function reprojectStoredPoints(id: string, geometry: BufferGeometry): void {
    const state = useMeasureStore.getState();
    const owned = state.points.filter((point) => point.solidId === id);
    if (owned.length === 0 && state.thickness?.solidId !== id) return;
    const mesh = triangleMeshFromGeometry(geometry);
    let cleared = false;
    const points = state.points.map((point) => {
        if (point.solidId !== id) return point;
        const near = nearestSurfacePoint(mesh, point.export);
        if (!near || near.distance > REPROJECT_CLEAR_MM) {
            cleared = true;
            return point;
        }
        return { ...point, export: near.point, normal: near.normal };
    });
    const thickness =
        state.thickness?.solidId === id
            ? (() => {
                  const near = nearestSurfacePoint(mesh, state.thickness.export);
                  if (!near || near.distance > REPROJECT_CLEAR_MM) {
                      cleared = true;
                      return state.thickness;
                  }
                  return { ...state.thickness, export: near.point, normal: near.normal };
              })()
            : state.thickness;
    if (cleared) {
        useMeasureStore.setState({
            points: [],
            thickness: null,
            thicknessMm: null,
            notice: "Measurements cleared — the mesh changed and the points no longer sit on the surface.",
        });
        return;
    }
    useMeasureStore.setState({ points, thickness, notice: null });
}
