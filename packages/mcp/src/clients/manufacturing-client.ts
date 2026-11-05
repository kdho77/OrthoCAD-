/**
 * Mirrors vertex/src/features/exports/export-service.ts manufacturing tRPC usage.
 * CAD mesh build stays in the OrthoCAD browser — callers must upload STL first.
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
    };
    design: {
        get: {
            query: (input: { id: string }) => Promise<Record<string, unknown>>;
        };
    };
};

export interface ManufacturingClientOptions {
    trpcUrl: string;
    bearerToken: string;
    fetchImpl?: typeof fetch;
}

export function createManufacturingClient(options: ManufacturingClientOptions) {
    const trpc = createTRPCClient({
        links: [
            httpBatchLink({
                url: options.trpcUrl,
                transformer: superjson,
                headers: () => ({
                    authorization: `Bearer ${options.bearerToken}`,
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

        /** Call site: vertex/server/src/routers/manufacturing.ts getGcodeDownloadUrl */
        getGcodeDownloadUrl(productionId: string) {
            return trpc.manufacturing.getGcodeDownloadUrl.query({ productionId });
        },

        /** Production parameter snapshot — settingsJson on the design document. */
        getDesignParams(designId: string) {
            return trpc.design.get.query({ id: designId });
        },
    };
}

export type ManufacturingClient = ReturnType<typeof createManufacturingClient>;
