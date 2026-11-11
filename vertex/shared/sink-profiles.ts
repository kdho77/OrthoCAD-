// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Sink profile table shared by the human UI and the saved-design snapshot.
// Numbers match the previous table in geometry/sink.ts. Cut math stays there.

import type { SinkKind } from "../src/types/index.js";

/** Library default requested depth. addSink and an omitted catalog depth_mm use this. */
export const SINK_DEFAULT_DEPTH_MM = 2;

/** 5th IPJ / styloid long-axis angle. Negative tips the distal end toward medial on a right foot. */
export const STYLOID_ROTATION_DEG = -15;

/** Which border of the foot a sink belongs on. Same union as geometry/handedness.ts AnatomicalSide. */
type AnatomicalSide = "medial" | "lateral" | "midline";

export interface SinkProfile {
    kind: SinkKind;
    label: string;
    /** Heel → toe, fraction of the outline. */
    u: number;
    /** Medial → lateral, fraction of the outline. */
    v: number;
    /** Oval length along the local outline tangent, mm at Men's 9. */
    lengthMm: number;
    /** Oval width across that tangent, mm at Men's 9. */
    widthMm: number;
    blendMm: number;
    defaultDepthMm: number;
    maxDepthMm: number;
    /** Deepest point shift toward the heel, mm. Not scaled. Zero keeps a true oval. */
    deepestProximalMm: number;
    /** Deepest point shift toward lateral, mm. Not scaled. Zero keeps a true oval. */
    deepestLateralMm: number;
    /**
     * Long-axis angle on a right foot, degrees from distal toward lateral.
     * Left feet use the opposite sign. Zero is a foot-axis oval (a circle when the axes match).
     */
    rotationDeg: number;
    /** Keep the cut off the lateral wall. */
    lateralWallFade: boolean;
    /** Keep the cut off the medial wall. */
    medialWallFade: boolean;
    forefoot: boolean;
    /** Registered border. Placement and the viewer must follow this, not a copied world Y. */
    anatomicalSide: AnatomicalSide;
}

export const SINK_KIND_ORDER: readonly SinkKind[] = [
    "mpj1",
    "mpj2",
    "mpj3",
    "mpj4",
    "mpj5",
    "rkw",
    "styloid",
];

export const SINK_PROFILES: Record<SinkKind, SinkProfile> = {
    mpj1: {
        kind: "mpj1",
        label: "1st MPJ",
        u: 0.665,
        v: 0.145,
        lengthMm: 22,
        widthMm: 22,
        blendMm: 7,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 4,
        deepestProximalMm: 3,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        medialWallFade: true,
        forefoot: true,
        anatomicalSide: "medial",
    },
    mpj2: {
        kind: "mpj2",
        label: "2nd MPJ",
        u: 0.685,
        v: 0.365,
        lengthMm: 16,
        widthMm: 16,
        blendMm: 5,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
        anatomicalSide: "medial",
    },
    mpj3: {
        kind: "mpj3",
        label: "3rd MPJ",
        u: 0.68,
        v: 0.55,
        lengthMm: 15,
        widthMm: 15,
        blendMm: 5,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
        anatomicalSide: "lateral",
    },
    mpj4: {
        kind: "mpj4",
        label: "4th MPJ",
        u: 0.665,
        v: 0.715,
        lengthMm: 13,
        widthMm: 13,
        blendMm: 5,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
        anatomicalSide: "lateral",
    },
    mpj5: {
        kind: "mpj5",
        label: "5th MPJ",
        u: 0.64,
        v: 0.88,
        lengthMm: 13,
        widthMm: 13,
        blendMm: 5,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 4,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: true,
        medialWallFade: false,
        forefoot: true,
        anatomicalSide: "lateral",
    },
    rkw: {
        kind: "rkw",
        label: "Reverse kinetic wedge",
        u: 0.665,
        /** Center on the 1st MPJ. Live width is 0.32 of the local span, not this nominal. */
        v: 0.15,
        lengthMm: 45,
        widthMm: 32,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 4,
        deepestProximalMm: 3,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        // The 6 mm taper crosses the medial outline. Fade the cut on that rim
        // the same way the 1st MPJ does, so the wall is not sheared.
        medialWallFade: true,
        forefoot: true,
        anatomicalSide: "medial",
    },
    styloid: {
        kind: "styloid",
        label: "5th IPJ (Styloid)",
        u: 0.42,
        v: 0.92,
        lengthMm: 20,
        widthMm: 14,
        blendMm: 8,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: STYLOID_ROTATION_DEG,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: false,
        anatomicalSide: "lateral",
    },
};

export const SINK_LABELS: Record<SinkKind, string> = {
    mpj1: SINK_PROFILES.mpj1.label,
    mpj2: SINK_PROFILES.mpj2.label,
    mpj3: SINK_PROFILES.mpj3.label,
    mpj4: SINK_PROFILES.mpj4.label,
    mpj5: SINK_PROFILES.mpj5.label,
    rkw: SINK_PROFILES.rkw.label,
    styloid: SINK_PROFILES.styloid.label,
};
