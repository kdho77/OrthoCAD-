// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Builds the VertexSlice `model` part for one foot.
// No regions, or the regional gate off: the leader-blocked STL bytes.
// Regions and the gate on: a 3MF whose main object is that same solid
// and whose modifier volumes stay in that coordinate frame.

import { effectiveHardnessRegions } from "@/lib/hardness/collect";
import { readPackedHardness3mf } from "@/lib/hardness/export-3mf";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { exportHardness3mf } from "@/lib/hardness/pipeline";
import type { DesignState, Side } from "@/types";
import {
    assertRegionalInfillPreset,
    VERTEXSLICE_3MF_CONTENT_TYPE,
    VERTEXSLICE_3MF_FILENAME,
    VERTEXSLICE_STL_CONTENT_TYPE,
} from "../../../shared/vertexslice-regional-3mf";

export type RegionalCapability =
    | { state: "enabled" }
    | { state: "disabled" }
    | { state: "unknown"; reason: string };

/** A 2xx body is enabled or disabled. Anything else could not be checked. */
export function parseRegionalCapability(body: unknown): RegionalCapability {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return { state: "unknown", reason: "malformed capability response" };
    }
    const enabled = (body as { enabled?: unknown }).enabled;
    if (typeof enabled !== "boolean") {
        return { state: "unknown", reason: "malformed capability response (missing enabled)" };
    }
    return enabled ? { state: "enabled" } : { state: "disabled" };
}

/**
 * No effective regions: today's STL request.
 * Effective regions and an explicit enabled check: 3MF.
 * Effective regions and an explicit off, or a check that did not succeed: stop.
 * A failed check must not fall through to a single-density STL.
 */
export function regionalSliceDecision(args: {
    effectiveRegionCount: number;
    capability: RegionalCapability;
}): { action: "stl" } | { action: "3mf" } | { action: "fail"; message: string } {
    if (args.effectiveRegionCount <= 0) return { action: "stl" };
    if (args.capability.state === "enabled") return { action: "3mf" };
    if (args.capability.state === "disabled") {
        return {
            action: "fail",
            message: "Regional hardness is turned off on this server. Refusing a single-density print.",
        };
    }
    return {
        action: "fail",
        message: `Regional hardness could not be confirmed (${args.capability.reason}). Refusing a single-density print.`,
    };
}

export interface VertexSliceModelPart {
    filename: string;
    contentType: typeof VERTEXSLICE_STL_CONTENT_TYPE | typeof VERTEXSLICE_3MF_CONTENT_TYPE;
    bytes: Uint8Array;
    /** modifier_part count. Zero means the STL path. */
    regionCount: number;
}

function stlPart(manufacturingStl: ArrayBuffer, stlFilename: string): VertexSliceModelPart {
    return {
        filename: stlFilename,
        contentType: VERTEXSLICE_STL_CONTENT_TYPE,
        bytes: new Uint8Array(manufacturingStl.slice(0)),
        regionCount: 0,
    };
}

/**
 * One foot. `manufacturingStl` is the leader-blocked solid already sent as STL
 * (same scale; an M9 foot stays 275.0 mm). Modifier prisms use the design frame,
 * which is that solid's frame before the leader triangles are appended.
 */
export async function buildVertexSliceModel(args: {
    design: DesignState;
    side: Side;
    manufacturingStl: ArrayBuffer;
    /** Filename the STL request uses today (`left.stl` / `right.stl`). */
    stlFilename: string;
    regional3mfEnabled: boolean;
}): Promise<VertexSliceModelPart> {
    if (!args.regional3mfEnabled) return stlPart(args.manufacturingStl, args.stlFilename);
    const regions = effectiveHardnessRegions(args.design, args.side);
    if (regions.length === 0) return stlPart(args.manufacturingStl, args.stlFilename);

    for (const region of regions) assertRegionalInfillPreset(region);

    const shell = parseBinaryStl(args.manufacturingStl);
    const packed = await exportHardness3mf({
        design: args.design,
        side: args.side,
        shell,
    });
    const read = await readPackedHardness3mf(packed.bytes);
    if (read.modifiers.length === 0) {
        throw new Error(
            "Regional hardness was requested but the 3MF has no modifier regions. Refusing a single-density print.",
        );
    }
    return {
        filename: VERTEXSLICE_3MF_FILENAME,
        contentType: VERTEXSLICE_3MF_CONTENT_TYPE,
        bytes: packed.bytes,
        regionCount: read.modifiers.length,
    };
}
