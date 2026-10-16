// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    defaultWallLoopsForMaterial,
    VERTEXSLICE_MATERIAL_DISPLAY,
    type VertexSliceMaterialId,
} from "../../../shared/vertexslice/contract";

export interface MaterialCard {
    id: VertexSliceMaterialId;
    name: string;
    description: string;
    shore?: string;
}

/** One-line clinic copy. Shore hardness only when known from the VertexSlice filament. */
export const MATERIAL_CARDS: MaterialCard[] = [
    {
        id: "apex_core",
        name: VERTEXSLICE_MATERIAL_DISPLAY.apex_core,
        description: "Everyday TPU for standard insoles.",
        shore: "Shore 95A",
    },
    {
        id: "apex_light",
        name: VERTEXSLICE_MATERIAL_DISPLAY.apex_light,
        description: "Foaming TPU for a lighter print.",
        shore: "Shore 90A",
    },
    {
        id: "apex_forge",
        name: VERTEXSLICE_MATERIAL_DISPLAY.apex_forge,
        description: "Higher-temp TPU for tougher insoles.",
    },
    {
        id: "apex_bounce",
        name: VERTEXSLICE_MATERIAL_DISPLAY.apex_bounce,
        description: "TPU with a heated bed for more rebound.",
    },
];

export function standardWallLabel(material: VertexSliceMaterialId | null): string {
    const n = defaultWallLoopsForMaterial(material);
    return n === 1 ? `Standard: ${n} wall` : `Standard: ${n} walls`;
}
