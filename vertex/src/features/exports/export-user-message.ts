// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

const HEEL_CUP_STL_BLOCKED_MSG = "Heel cup depth correction can't be exported right now (depth must be 0).";

/**
 * Map mesh-close / export-gate failures to a plain UI message.
 * Used by ExportPanel (STL) and PrintingPanel (hybrid G-code), both of which
 * surface `export-service` `res.reason` strings that would otherwise show raw
 * `[MESH-CLOSE] … openEdges=…` diagnostics.
 */
export function stlExportUserMessage(reason: string | undefined): string {
    if (!reason) return "Export failed";
    if (
        reason.includes("[MESH-CLOSE]") ||
        reason.includes("heelBridgeSelfIntersections") ||
        reason.includes("MeshNotWatertight")
    ) {
        return HEEL_CUP_STL_BLOCKED_MSG;
    }
    return reason;
}
