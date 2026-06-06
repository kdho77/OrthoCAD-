import type { TrimLine } from "@/lib/geometry/mesh-edit";

/** Plain-object trim lines safe for worker postMessage. */
export interface SerializedTrimLine {
    id: string;
    points: { x: number; y: number; z: number }[];
}

export interface SerializedVertexOverride {
    index: number;
    x: number;
    y: number;
    z: number;
}

export function serializeTrimLines(lines: TrimLine[]): SerializedTrimLine[] {
    return lines.map((l) => ({
        id: l.id,
        points: l.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    }));
}

export function serializeVertexOverrides(overrides: Map<number, { x: number; y: number; z: number }>): SerializedVertexOverride[] {
    return [...overrides.entries()].map(([index, v]) => ({ index, x: v.x, y: v.y, z: v.z }));
}
