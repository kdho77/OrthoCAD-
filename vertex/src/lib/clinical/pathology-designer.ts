// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";

/**
 * Future AI biomechanics designer. One-click calls this only for a
 * pathology-only Rx (a diagnosis with no explicit parametric correction,
 * element, or sink). The stub does not invent a design.
 */
export type PathologyDesignRequest = {
    text: string;
    sides: Side[];
};

export type PathologyDesignResult = {
    status: "needs_design";
    reason: string;
};

export interface PathologyDesigner {
    design(request: PathologyDesignRequest): PathologyDesignResult;
}

export const stubPathologyDesigner: PathologyDesigner = {
    design(request) {
        const who = request.sides.length ? request.sides.join(" and ") : "the prescription";
        return {
            status: "needs_design",
            reason: `Pathology-only Rx for ${who} needs a biomechanics design. No correction was guessed.`,
        };
    },
};
