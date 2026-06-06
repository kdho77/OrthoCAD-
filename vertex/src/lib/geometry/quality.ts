/** Mesh resolution presets — preview keeps 60fps during interaction. */
export type GeometryQuality = "preview" | "full";

export const QUALITY_SEGMENTS: Record<GeometryQuality, { segmentsX: number; segmentsY: number }> = {
    preview: { segmentsX: 48, segmentsY: 24 },
    full: { segmentsX: 96, segmentsY: 48 },
};

export function segmentsForQuality(quality: GeometryQuality) {
    return QUALITY_SEGMENTS[quality];
}
