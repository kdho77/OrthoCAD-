// Frozen thresholds for the sink-depth gates.
// Authored against base 268aac85847160b5b2703a05688721ea4cb93b24 only.
// Do not edit after the freeze commit. Hashes below are filled from that base
// run and then frozen with the rest of this file.

/** Remaining floor under a depth-2 sink in a 3 mm shell. */
export const FLOOR_TARGET_MM = 1;
export const FLOOR_TOL_MM = 0.15;

/** Flat shell: configured depth must come off the top, not merely land near it. */
export const EXACT_TOL_MM = 0.05;

/** A cut may not go deeper than the configured depth by more than this. */
export const NOT_DEEPER_MM = 0.05;

/** Curved export mesh: other sinks' plateau drop vs depthMm. */
export const EXPORT_DROP_TOL_MM = 0.15;

export const SHELL_MM = 3;
export const OBSERVED_DEPTH_MM = 2;

/** Ring around the pad stays the unsunk shell. */
export const RING_TOL_MM = 0.15;

/** Belt / plantar face must not move when a sink is cut. */
export const BELT_MOVE_MAX_MM = 0.02;

/** Top-sheet XY is not a sink degree of freedom. */
export const XY_MOVE_MAX_MM = 0.02;

export const PLATEAU_WEIGHT = 0.98;
export const INTERIOR_WEIGHT = 0.999;
/** Outer feather only. A higher weight is the taper, not the ring around the pad. */
export const RING_WEIGHT_MAX = 0.05;
export const MIN_PLATEAU_SAMPLES = 20;
export const MIN_RING_SAMPLES = 8;
export const MIN_INTERIOR_SAMPLES = 4;
export const MAX_RAY_MISS_FRACTION = 0.1;

export const SAMPLE_STEP_MM = 1;
export const FLAT_STEP_MM = 1.5;

/**
 * Position SHA-256 of the no-sink export meshes on the frozen base.
 * Empty until the base instrument run prints them; the freeze commit
 * stores the values and they are not edited afterwards.
 */
export const BASE_NOSINK_HASHES = {
    /** reconstructProceduralPreview, left, round wall, no sinks, no thickness override. */
    defaultNoSink: "fe88d0a938c0b009b15964b5cb5f606b1326bcbc1740c9d51d48c932ee9a5600",
    /** Uniform 3 mm shell, left, round wall, no sinks. */
    uniform3NoSink: "1e75979e06a5f33d9c5c7511c2c60c64406e76256e230e43982041fd8276d2f0",
} as const;

export function hashesFrozen(): boolean {
    return BASE_NOSINK_HASHES.defaultNoSink.length === 64 && BASE_NOSINK_HASHES.uniform3NoSink.length === 64;
}

export function floorBand(): { lo: number; hi: number } {
    return { lo: FLOOR_TARGET_MM - FLOOR_TOL_MM, hi: FLOOR_TARGET_MM + FLOOR_TOL_MM };
}

export function inBand(value: number, lo: number, hi: number): boolean {
    return Number.isFinite(value) && value >= lo - 1e-9 && value <= hi + 1e-9;
}
