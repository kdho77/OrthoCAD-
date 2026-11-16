// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// One CNC file for the Mill export. The browser and the server bundle both call this.

import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { generateCncJob } from "@/lib/cnc/export";
import type { PartPlacement } from "@/lib/cnc/placement";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import type { CncJobResult, MillingProfile } from "@/lib/cnc/types";
import type { DesignState, Side } from "@/types";
import { isMilledOrder, millExportSides } from "./order-sides";

export { designStateFromDocument } from "@/features/clients/design-document";
export { isMilledOrder, millExportSides } from "./order-sides";

/** Mirror of belt G-code refusing a milled order ("Milled orders are not belt G-code"). */
export const PRINT_ORDER_CNC_REFUSAL = "Print orders are not CNC G-code";

export function assertMilledCncOrder(design: { method?: string }): void {
    if (!isMilledOrder(design)) throw new Error(PRINT_ORDER_CNC_REFUSAL);
}

export interface MillCncGcode {
    gcode: string;
    sides: Side[];
    /** Profile extension, including the leading dot. The default Idaho profile is `.gcode`. */
    fileExtension: string;
    stats: CncJobResult["stats"];
}

/**
 * G-code bytes for one Mill export.
 * Default profile is Idaho (`IDAHO_PROFILE`), default placements are empty,
 * and a milled order's sides are {@link millExportSides} (`cncSidesForOrder`).
 * Thickness is resolved inside `workpiecesFromDesign` (`thicknessMmForDesignSide`).
 */
export async function buildMillCncGcode(input: {
    design: DesignState;
    profile?: MillingProfile;
    placements?: PartPlacement[];
    requestedSides?: Side[];
}): Promise<MillCncGcode> {
    const profile = input.profile ?? cloneProfile(IDAHO_PROFILE);
    const sides = millExportSides(input.design, input.requestedSides);
    const parts = await workpiecesFromDesign(input.design, sides, profile);
    if (parts.length === 0) throw new Error("No insole geometry to mill");
    const job = generateCncJob(profile, parts, { placements: input.placements ?? [] });
    return {
        gcode: job.gcode,
        sides,
        fileExtension: profile.fileExtension || ".gcode",
        stats: job.stats,
    };
}
