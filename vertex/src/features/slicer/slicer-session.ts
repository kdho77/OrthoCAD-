// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Self-serve slicer session policy.
 *
 * Uploaded STL/3MF files and sliced G-code live in React memory for this
 * browser tab only. The slicer must never persist designs, clients, or orders,
 * and must never call CAD stock-base loaders.
 */
export const SLICER_SESSION_POLICY = {
    persistDesigns: false,
    persistClients: false,
    persistOrders: false,
    persistFiles: false,
    persistGcode: false,
} as const;

/** APIs the slicer feature must not call. Enforced by slicer-session.test.ts. */
export const SLICER_SESSION_FORBIDDEN_APIS = [
    "ensureDefaultStockBaseResolved",
    "useDesignStore",
    "trpc.designs",
    "trpc.clients",
    "trpc.orders",
    "saveDesign",
    "createClient",
    "createOrder",
    "localStorage",
    "indexedDB",
    "sessionStorage",
] as const;

export const SLICER_SESSION_NOTICE =
    "This file stays in this browser session. Nothing is saved to your account — no designs, clients, or orders.";

export function isSlicerPersistenceEnabled(): false {
    return SLICER_SESSION_POLICY.persistFiles;
}
