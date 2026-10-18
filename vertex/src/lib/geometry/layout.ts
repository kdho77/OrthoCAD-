// Shared insole layout constants (mm) used by the viewer, element placement and
// export pipeline so geometry, markers and exports stay in lock-step.
//
// INSOLE_LENGTH_MM / INSOLE_WIDTH_MM are the Men's 9 reference template. Live
// designs resolve sized dimensions via insoleLayoutFromDesign() in shoe-size.ts.

export const INSOLE_LENGTH_MM = 260;
export const INSOLE_WIDTH_MM = 95;
export const INSOLE_GAP_MM = 30;

/**
 * Local-Y (width-axis) offset for a foot when both insoles are shown side by side.
 * After viewer Rx(−90°) this becomes world −Z, so left=+offset → world Z negative →
 * screen-left under the toe-up Top preset (up=+X). Magnitude unchanged; sign only.
 * Presentation-only — never persisted on the design record / export geometry.
 */
export function sideOffsetX(side: "left" | "right", widthMm: number = INSOLE_WIDTH_MM): number {
    return side === "left" ? (widthMm + INSOLE_GAP_MM) / 2 : -(widthMm + INSOLE_GAP_MM) / 2;
}
