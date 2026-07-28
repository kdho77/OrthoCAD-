// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Shared insole layout constants (mm) used by the viewer, element placement and
// export pipeline so geometry, markers and exports stay in lock-step.

export const INSOLE_LENGTH_MM = 260;
export const INSOLE_WIDTH_MM = 95;
export const INSOLE_GAP_MM = 30;

/**
 * Local-Y separation for a foot when both insoles are shown side by side.
 *
 * Applied on the footprint width axis (Y) before the viewer Rx(−90°) group
 * rotation, which maps local +Y → world −Z. Left uses negative Y so it lands
 * at world +Z and projects screen-left under the anatomical camera presets.
 */
export function sideOffsetX(side: "left" | "right"): number {
    return side === "left" ? -(INSOLE_WIDTH_MM + INSOLE_GAP_MM) / 2 : (INSOLE_WIDTH_MM + INSOLE_GAP_MM) / 2;
}
