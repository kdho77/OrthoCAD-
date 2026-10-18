// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { defaultDesign } from "@/stores/design-store";
import type { DesignState, PlacedElement } from "@/types";
import type { HardnessRegion } from "../../../shared/print-recipe/hardness-region";
import { migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";

function pad(
    id: string,
    kind: PlacedElement["kind"],
    side: PlacedElement["side"],
    extra: Partial<PlacedElement>,
): PlacedElement {
    return {
        id,
        kind,
        side,
        position: { x: 0, y: 0 },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        heightMm: 3,
        regionId: id,
        hardnessClass: "Medium",
        priority: 1,
        depth: { type: "element", depthBelowMm: 2 },
        ...extra,
    };
}

/** SAMPLE_Top L+R with met_pad + dancer's pad (Phase 1 fixture). */
export function fixtureSampleTopElements(): DesignState {
    const d = defaultDesign();
    d.elements = [
        pad("el-met-left", "met_pad", "left", {
            hardnessClass: "Soft",
            priority: 2,
            position: { x: 40, y: 0 },
        }),
        pad("el-dancer-left", "dancers_pad", "left", {
            hardnessClass: "Hard",
            priority: 1,
            position: { x: 50, y: -18 },
        }),
        pad("el-met-right", "met_pad", "right", {
            hardnessClass: "Soft",
            priority: 2,
            position: { x: 40, y: 0 },
        }),
        pad("el-dancer-right", "dancers_pad", "right", {
            hardnessClass: "Hard",
            priority: 1,
            position: { x: 50, y: 18 },
        }),
    ];
    return d;
}

export function fixtureFreehandAndAbutting(): DesignState {
    const d = fixtureSampleTopElements();
    const recipe = migratePrintRecipe(d.printRecipe);
    const freehandSoft: HardnessRegion = {
        regionId: "fh-soft-overlap",
        kind: "freehand",
        hardnessClass: "Soft",
        priority: 2,
        depth: { type: "full" },
        side: "left",
        polygon: [
            { x: 155, y: -8 },
            { x: 185, y: -8 },
            { x: 185, y: 8 },
            { x: 155, y: 8 },
        ],
        label: "equal-priority softer freehand",
    };
    const freehandHard: HardnessRegion = {
        regionId: "fh-hard-higher",
        kind: "freehand",
        hardnessClass: "Extra Hard",
        priority: 5,
        depth: { type: "mm", mm: 3 },
        side: "left",
        polygon: [
            { x: 160, y: -4 },
            { x: 178, y: -4 },
            { x: 178, y: 4 },
            { x: 160, y: 4 },
        ],
        label: "higher-priority harder freehand",
    };
    const abutA: HardnessRegion = {
        regionId: "zone-abut-a",
        kind: "zone",
        hardnessClass: "Medium",
        priority: 0,
        depth: { type: "full" },
        side: "left",
        polygon: [
            { x: 40, y: 10 },
            { x: 70, y: 10 },
            { x: 70, y: 22 },
            { x: 40, y: 22 },
        ],
    };
    const abutB: HardnessRegion = {
        regionId: "zone-abut-b",
        kind: "zone",
        hardnessClass: "Hard",
        priority: 0,
        depth: { type: "full" },
        side: "left",
        polygon: [
            { x: 40, y: 22.15 },
            { x: 70, y: 22.15 },
            { x: 70, y: 34 },
            { x: 40, y: 34 },
        ],
    };
    d.printRecipe = { ...recipe, zones: [freehandSoft, freehandHard, abutA, abutB] };
    return d;
}

export function fixturePhaseBLegacy(): DesignState {
    const d = defaultDesign();
    d.printRecipe = migratePrintRecipe({
        version: 1,
        pattern: "gyroid",
        defaultHardness: "Medium",
        zones: [],
    } as never);
    return d;
}

export function fixtureThreeWayOverlap(): DesignState {
    const d = defaultDesign();
    const recipe = migratePrintRecipe(d.printRecipe);
    const box = (
        id: string,
        cls: HardnessRegion["hardnessClass"],
        pri: number,
        dx: number,
    ): HardnessRegion => ({
        regionId: id,
        kind: "zone",
        hardnessClass: cls,
        priority: pri,
        depth: { type: "full" },
        side: "left",
        polygon: [
            { x: 80 + dx, y: -10 },
            { x: 110 + dx, y: -10 },
            { x: 110 + dx, y: 10 },
            { x: 80 + dx, y: 10 },
        ],
    });
    d.printRecipe = {
        ...recipe,
        zones: [box("tw-a", "Soft", 1, 0), box("tw-b", "Medium", 1, 12), box("tw-c", "Hard", 2, 6)],
    };
    return d;
}

/** Tiny Orca-like gcode with fingerprint speeds (mm/min = mm/s * 60). */
export const FIXTURE_GCODE = `;LINE_WIDTH:0.7
;INFILL_DENSITY:16
;TYPE:Sparse infill
G1 X10 Y8 E0.05 F2610
;LINE_WIDTH:0.7
;INFILL_DENSITY:22
;TYPE:Sparse infill
G1 X10 Y10 E0.1 F2640
G1 X12 Y10 E0.2 F2640
;LINE_WIDTH:1.0
;INFILL_DENSITY:26
;TYPE:Sparse infill
G1 X10 Y12 E0.3 F2670
G1 X12 Y12 E0.4 F2670
;LINE_WIDTH:1.2
;INFILL_DENSITY:26
;TYPE:Sparse infill
G1 X10 Y14 E0.5 F1380
;LINE_WIDTH:1.2
;INFILL_DENSITY:30
;TYPE:Sparse infill
G1 X10 Y16 E0.6 F1380
;TYPE:Internal solid infill
G1 X10 Y18 E0.7 F1200
`;
