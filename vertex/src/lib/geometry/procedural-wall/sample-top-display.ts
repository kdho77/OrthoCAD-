// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Viewer display policy for SAMPLE_Top.
 *
 * Production (persisted + auth) remounts the base-mesh hook when stock-server
 * flags flip after login. SAMPLE_Top is a public static GLB — those flags must
 * not dispose the top sheet. EdgesGeometry on the 42k-vert sheet also unmounts
 * the mesh while the cheaper bottom-pattern overlays stay.
 */

/** Skip R3F EdgesGeometry above this vertex count (SAMPLE_Top is ~42k). */
export const BASE_EDGE_VERTEX_LIMIT = 10_000;

export type StockResolutionFlag = "idle" | "loading" | "resolved" | "failed";

/**
 * Effect-dep key for the SAMPLE_Top / stock load. Procedural preview ignores
 * server stock-resolution churn so login bootstrap cannot remount the mesh.
 */
export function proceduralViewerStockGate(
    wallModel: "legacy" | "procedural" | undefined,
    stockBaseLoading: boolean,
    stockBaseResolutionState: StockResolutionFlag,
): string {
    if ((wallModel ?? "procedural") === "procedural") return "procedural";
    return `${stockBaseLoading ? "1" : "0"}:${stockBaseResolutionState}`;
}

/** Hide the top sheet only when there is nothing to draw — keep last geometry while rebuilding. */
export function shouldHideBaseMesh(hasGeometry: boolean, _building: boolean): boolean {
    return !hasGeometry;
}

/** Edge extract is fine on small parametric shells; SAMPLE_Top is too dense. */
export function shouldExtractBaseEdges(vertexCount: number, interacting: boolean): boolean {
    if (interacting || vertexCount <= 0) return false;
    return vertexCount <= BASE_EDGE_VERTEX_LIMIT;
}
