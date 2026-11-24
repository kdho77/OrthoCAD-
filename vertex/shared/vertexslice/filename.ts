// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    VERTEXSLICE_MATERIAL_DISPLAY,
    type VertexSliceMaterialId,
    type VertexSlicePrintDirection,
} from "./contract.js";

function sanitizeStem(name: string): string {
    const stem = name.replace(/\.[^.]+$/, "").trim() || "model";
    return stem.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "model";
}

/**
 * `{model}_{material}_{toe|heel}first_{walls}w.gcode`
 * Material uses the UI display name (ApexCore, …).
 */
export function slicerDownloadFilename(opts: {
    modelName: string;
    material: VertexSliceMaterialId;
    printDirection: VertexSlicePrintDirection;
    wallLoops: number;
}): string {
    const model = sanitizeStem(opts.modelName);
    const material = VERTEXSLICE_MATERIAL_DISPLAY[opts.material];
    const direction = opts.printDirection === "heel_first" ? "heelfirst" : "toefirst";
    return `${model}_${material}_${direction}_${opts.wallLoops}w.gcode`;
}
