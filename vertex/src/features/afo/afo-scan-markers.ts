// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { geometryToAfoMesh } from "@/lib/geometry/afo/mesh-ops";
import { type AfoOrientResult, orientScanThreePoint } from "@/lib/geometry/afo/orient";
import type { AfoTriMesh, AfoVec3 } from "@/lib/geometry/afo/types";

/** Labels for the AFO 3-point orient (heel, medial mal, lateral mal). */
export const AFO_MARKER_LABELS = {
    M1: "M1 — heel",
    M2: "M2 — medial malleolus",
    M3: "M3 — lateral malleolus",
    ARCH: "ARCH — not used for AFO",
} as const;

/**
 * Insole placement waits on the loaded landmark base.
 * AFO has no insole base — the scan itself is the placement target.
 */
export function markerPlaceControl(opts: { isAfo: boolean; hasLandmarkBase: boolean }): {
    enabled: boolean;
    blockedTitle: string | null;
} {
    if (opts.isAfo || opts.hasLandmarkBase) return { enabled: true, blockedTitle: null };
    return { enabled: false, blockedTitle: "Base geometry not loaded" };
}

/** Scan clicks place M1–M3. AFO design landmarks take over only after that session ends. */
export function activeMarkerPlacementLayer(
    isAfo: boolean,
    placingScanMarkers: boolean,
): "scan" | "afo-design" {
    return isAfo && !placingScanMarkers ? "afo-design" : "scan";
}

export function scanIdForThreePointOrient(
    scans: { id: string; side: "left" | "right" }[],
    markersByScanId: Record<string, { M1?: unknown; M2?: unknown; M3?: unknown } | undefined>,
    editing: "left" | "right" | "both",
): string | null {
    const ready = scans.filter((scan) => {
        const m = markersByScanId[scan.id];
        return Boolean(m?.M1 && m.M2 && m.M3);
    });
    const preferred =
        editing === "left" || editing === "right" ? ready.find((scan) => scan.side === editing) : ready[0];
    return (preferred ?? ready[0])?.id ?? null;
}

function scaleMesh(mesh: AfoTriMesh, scale: number): AfoTriMesh {
    if (scale === 1) return mesh;
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i++) positions[i] = (mesh.positions[i] ?? 0) * scale;
    return { positions, indices: mesh.indices };
}

function scaleVec(p: AfoVec3, scale: number): AfoVec3 {
    if (scale === 1) return p;
    return { x: p.x * scale, y: p.y * scale, z: p.z * scale };
}

/**
 * Rigid 3-point orient in millimetres. `displayScale` is the discrete unit
 * correction (1 / 10 / 1000) already used for provisional display — not a fit.
 */
export function afoOrientFromScanMarkers(
    geometry: BufferGeometry,
    markers: { M1: AfoVec3; M2: AfoVec3; M3: AfoVec3 },
    displayScale: number,
): AfoOrientResult {
    const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
    const mesh = scaleMesh(geometryToAfoMesh(geometry), scale);
    return orientScanThreePoint(
        mesh,
        scaleVec(markers.M1, scale),
        scaleVec(markers.M2, scale),
        scaleVec(markers.M3, scale),
    );
}
