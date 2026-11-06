/**
 * Manufacturing wrap: tRPC `manufacturing.*` on main → `generateSolid` → Python `/manufacture`
 * (see vertex/server/src/lib/manufacturing-client.ts). PR #263 merged to main (70e33f8a): Apex materials,
 * VertexSlice locked profiles, leader v2 on the printer G-code path. Phase A calls generateSolid only.
 * CAD mesh build stays in the OrthoCAD browser.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

/** Minimal tRPC surface for Phase A — mirrors vertex/server manufacturing + design routers. */
export type OrthocadMcpTrpcProxy = {
    manufacturing: {
        prepareManufacturingStlUpload: {
            mutate: (input: {
                side: "left" | "right";
                fileName?: string;
            }) => Promise<{ ok: true; storageKey: string; uploadUrl: string; token: string }>;
        };
        generateSolid: {
            mutate: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
        getGcodeDownloadUrl: {
            query: (input: {
                productionId: string;
            }) => Promise<{ downloadUrl: string; productionId: string }>;
        };
        persistSavedDesignSnapshot: {
            mutate: (input: { designId: string; catalog?: unknown }) => Promise<Record<string, unknown>>;
        };
    };
    design: {
        get: {
            query: (input: { id: string }) => Promise<Record<string, unknown>>;
        };
    };
};

export interface ManufacturingClientOptions {
    trpcUrl: string;
    /** Dedicated CAD-operator integration key (`Authorization: Bearer ocad_…`). */
    cadOperatorKey: string;
    fetchImpl?: typeof fetch;
}

export function createManufacturingClient(options: ManufacturingClientOptions) {
    const trpc = createTRPCClient({
        links: [
            httpBatchLink({
                url: options.trpcUrl,
                transformer: superjson,
                headers: () => ({
                    authorization: `Bearer ${options.cadOperatorKey}`,
                }),
                fetch: options.fetchImpl,
            }),
        ],
    }) as unknown as OrthocadMcpTrpcProxy;

    return {
        trpc,

        /** Same contract as trpc.manufacturing.prepareManufacturingStlUpload */
        prepareManufacturingStlUpload(input: { side: "left" | "right"; fileName?: string }) {
            return trpc.manufacturing.prepareManufacturingStlUpload.mutate(input);
        },

        /**
         * Requires stlStorageKey from a completed STL upload (browser CAD or PUT to signed URL).
         * Call site: vertex/server/src/routers/manufacturing.ts generateSolid
         */
        generateGcode(input: {
            designId?: string;
            side?: "left" | "right";
            presetId: string;
            stlStorageKey: string;
            outputType: "gcode" | "stl";
            beltAngleDeg?: number;
            fileName?: string;
            material?: string;
        }) {
            return trpc.manufacturing.generateSolid.mutate({
                beltAngleDeg: 45,
                ...input,
            });
        },

        /**
         * Server lofts the saved design with the Export path and slices belt G-code.
         * The placeholder storage key is rejected unless the server replaces it.
         */
        generateFromSavedDesign(input: {
            designId: string;
            side: "left" | "right";
            presetId: string;
            fileName?: string;
        }) {
            return trpc.manufacturing.generateSolid.mutate({
                designId: input.designId,
                side: input.side,
                presetId: input.presetId,
                stlStorageKey: "saved-design-internal",
                outputType: "gcode",
                beltAngleDeg: 45,
                useSavedDesignMesh: true,
                fileName: input.fileName,
            });
        },

        /** Call site: vertex/server/src/routers/manufacturing.ts getGcodeDownloadUrl */
        getGcodeDownloadUrl(productionId: string) {
            return trpc.manufacturing.getGcodeDownloadUrl.query({ productionId });
        },

        /** Production parameter snapshot — settingsJson on the design document. */
        getDesignParams(designId: string) {
            return trpc.design.get.query({ id: designId });
        },

        /**
         * Replace settingsJson on an existing design with a fail-closed SAMPLE_Top snapshot.
         * Call site: vertex/server/src/routers/manufacturing.ts persistSavedDesignSnapshot.
         * rx_text is not forwarded.
         */
        persistSavedDesignSnapshot(input: { designId: string; catalog?: unknown }) {
            return trpc.manufacturing.persistSavedDesignSnapshot.mutate({
                designId: input.designId,
                catalog: input.catalog,
            });
        },
    };
}

export type ManufacturingClient = ReturnType<typeof createManufacturingClient>;
