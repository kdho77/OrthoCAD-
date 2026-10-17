// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import type { Side } from "@/types";

export type ToolType = "ball" | "flat";
export type FeedClass = "dip" | "normal" | "slow" | "contour" | "rapid";
export type HeelDirection = "x0" | "xmax";
export type TopOffsetMeaning = "horizontal_overrun";
export type ZeroX = "left" | "right";
export type ZeroY = "front" | "back";
export type ZeroZ = "bottom" | "top";
export type PathStrategy = "spiral" | "zigzag";
export type AlignX = "left" | "center" | "right";
export type AlignY = "front" | "center" | "back";

export interface Point {
    x: number;
    y: number;
    z?: number;
}

export interface Pocket {
    x: number;
    y: number;
    width: number;
    length: number;
}

export interface Cutter {
    diameterMm: number;
    type: ToolType;
    rpm: number;
    enabled: boolean;
}

export interface FeedSet {
    dip: number;
    normal: number;
    slow: number;
    contour: number;
}

export interface CustomGcodeBlocks {
    toolpathStart: string;
    toolpathEnd: string;
    bottomStart: string;
    bottomEnd: string;
    contourStart: string;
    contourEnd: string;
}

export interface MillingProfile {
    id: string;
    name: string;
    brand: string;
    documentType: string;
    strategy: PathStrategy;
    dimensions: "2D" | "3D";
    strategyContour: PathStrategy;
    twoSides: boolean;
    twoSidesRotate: string;
    fileExtension: string;
    decimals: number;
    tableWidthMm: number;
    tableLengthMm: number;
    materialHeightMm: number;
    zeroX: ZeroX;
    zeroY: ZeroY;
    zeroZ: ZeroZ;
    freeMovementHeightMm: number;
    topOffsetMm: number;
    offsetBottomMm: number;
    createCenterline: boolean;
    zOffsetCorrectionMm: number;
    contourEnabled: boolean;
    extraMovementMm: number;
    supportEnabled: boolean;
    supportMm: number;
    layeredEnabled: boolean;
    layeredMm: number;
    flatEnabled: boolean;
    toolpathCutter: Cutter;
    contourCutter: Cutter;
    topFeeds: FeedSet;
    bottomFeeds: FeedSet;
    customGcode: CustomGcodeBlocks;
    pockets: Pocket[];
    alignX: AlignX;
    alignY: AlignY;
    insolesHorizontal: boolean;
    /** Founder-confirmed: heel toward X0 (left), toe right. Still configurable. */
    heelDirection: HeelDirection;
    /** Founder-confirmed: top offset is a horizontal overrun ring, not a Z allowance. Still configurable. */
    topOffsetMeaning: TopOffsetMeaning;
    stepoverBallMm: number;
    stepoverFlatMm: number;
    sampleMm: number;
    chordTolMm: number;
}

export interface Heightmap {
    originX: number;
    originY: number;
    cell: number;
    nx: number;
    ny: number;
    z: Float32Array;
    inside: Uint8Array;
}

export interface CncWorkpiece {
    side: Side;
    outline: Point[];
    heightmap: Heightmap;
    zMin: number;
    zMax: number;
    /** Composed mill top (XY = plan, Z = thickness). Orbit view only; omitted from the design hash. */
    mesh?: BufferGeometry;
}

export type CncErrorCode = "too_tall" | "no_fit" | "outline_open";

export class CncExportError extends Error {
    readonly code: CncErrorCode;
    constructor(code: CncErrorCode, message: string) {
        super(message);
        this.name = "CncExportError";
        this.code = code;
    }
}

export interface TaggedMove {
    kind: "rapid" | "cut" | "dwell" | "spindle" | "pause" | "raw" | "comment";
    x?: number;
    y?: number;
    z?: number;
    f?: number;
    feedClass?: FeedClass;
    s?: number;
    p?: number;
    text?: string;
}

export interface CncJobResult {
    gcode: string;
    moves: TaggedMove[];
    designHash: string;
    warnings: string[];
    stats: {
        estimatedTimeSec: number;
        cutDistanceMm: number;
        travelDistanceMm: number;
        moveCount: number;
    };
    placed: PlacedPart[];
}

export interface PlacedPart {
    side: Side;
    pocketIndex: number;
    rot180: boolean;
    /** Rotation about the outline centroid, degrees CCW. 0 = heel toward X0. */
    rotationDeg: number;
    cx: number;
    cy: number;
    tx: number;
    ty: number;
    outline: Point[];
    heightmap: Heightmap;
    zMin: number;
    zMax: number;
    /** Same composed top as {@link CncWorkpiece.mesh}; mill orbit reuses it (no per-frame rebuild). */
    mesh?: BufferGeometry;
}
