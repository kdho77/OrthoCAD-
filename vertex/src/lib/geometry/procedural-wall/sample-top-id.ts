// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Bundled top-only input that produced the approved procedural STLs. */
export const SAMPLE_TOP_PUBLIC_PATH = "/Templates/SAMPLE_Top.glb";
export const SAMPLE_TOP_GLB_PATH = "Templates/SAMPLE_Top.glb";
export const SAMPLE_TOP_ASSET_ID = "sample-top";
export const SAMPLE_TOP_NAME = "SAMPLE_Top";

/** Full-length SAMPLE_Top, or a distal trim cut from it. */
export type BundledTopShape = "full" | "34" | "sulcus";

export interface BundledTopTemplate {
    shape: BundledTopShape;
    assetId: string;
    name: string;
    glbPath: string;
    publicPath: string;
}

export const BUNDLED_TOP_TEMPLATES: readonly BundledTopTemplate[] = [
    {
        shape: "full",
        assetId: SAMPLE_TOP_ASSET_ID,
        name: SAMPLE_TOP_NAME,
        glbPath: SAMPLE_TOP_GLB_PATH,
        publicPath: SAMPLE_TOP_PUBLIC_PATH,
    },
    {
        shape: "34",
        assetId: "sample-top-34",
        name: "SAMPLE_Top 3/4",
        glbPath: "Templates/SAMPLE_Top_34.glb",
        publicPath: "/Templates/SAMPLE_Top_34.glb",
    },
    {
        shape: "sulcus",
        assetId: "sample-top-sulcus",
        name: "SAMPLE_Top sulcus",
        glbPath: "Templates/SAMPLE_Top_sulcus.glb",
        publicPath: "/Templates/SAMPLE_Top_sulcus.glb",
    },
];

/** Which bundled top a base refers to, or null for a custom library mesh. */
export function bundledTopShapeFromBase(
    base: { assetId?: string; glbPath?: string } | null | undefined,
): BundledTopShape | null {
    if (!base) return null;
    const path = (base.glbPath ?? "").replace(/^\/+/, "");
    for (const template of BUNDLED_TOP_TEMPLATES) {
        if (base.assetId === template.assetId) return template.shape;
        if (path === template.glbPath || path === template.publicPath.replace(/^\/+/, ""))
            return template.shape;
    }
    if (/(?:^|\/)SAMPLE_Top_34\.glb$/i.test(path)) return "34";
    if (/(?:^|\/)SAMPLE_Top_sulcus\.glb$/i.test(path)) return "sulcus";
    if (/(?:^|\/)SAMPLE_Top\.glb$/i.test(path)) return "full";
    return null;
}

export function bundledTopTemplate(shape: BundledTopShape): BundledTopTemplate {
    const found = BUNDLED_TOP_TEMPLATES.find((template) => template.shape === shape);
    if (!found) return BUNDLED_TOP_TEMPLATES[0]!;
    return found;
}

/** Trim family baked into the GLB. Full-length has no skive. */
export function distalTrimKind(shape: BundledTopShape | null | undefined): "34" | "sulcus" | null {
    if (shape === "34" || shape === "sulcus") return shape;
    return null;
}
