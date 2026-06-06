// Shared insole layout constants (mm) used by the viewer, element placement and
// export pipeline so geometry, markers and exports stay in lock-step.

export const INSOLE_LENGTH_MM = 260;
export const INSOLE_WIDTH_MM = 95;
export const INSOLE_GAP_MM = 30;

/** World X offset for a foot when both insoles are shown side by side. */
export function sideOffsetX(side: "left" | "right"): number {
    return side === "left" ? -(INSOLE_WIDTH_MM + INSOLE_GAP_MM) / 2 : (INSOLE_WIDTH_MM + INSOLE_GAP_MM) / 2;
}
