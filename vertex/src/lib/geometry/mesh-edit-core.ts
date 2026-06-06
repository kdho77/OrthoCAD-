import type { SerializedTrimLine, SerializedVertexOverride } from "@/lib/geometry/mesh-edit-serialize";
import type { GeometryBufferPayload } from "@/lib/geometry/geometry-buffer";

/** Worker-safe trim/vertex edits on raw buffers (no Three.js). */
export function applyEditsToPayload(
    payload: GeometryBufferPayload,
    trimLines: SerializedTrimLine[],
    vertexOverrides: SerializedVertexOverride[],
): GeometryBufferPayload {
    const positions = new Float32Array(payload.positions);

    for (const line of trimLines) {
        if (line.points.length < 2) continue;
        const a = line.points[0]!;
        const b = line.points[line.points.length - 1]!;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const dirX = b.x - a.x;
        const dirY = b.y - a.y;
        const len = Math.hypot(dirX, dirY) || 1;
        const nx = -dirY / len;
        const ny = dirX / len;

        for (let i = 0; i < positions.length; i += 3) {
            const px = positions[i]!;
            const py = positions[i + 1]!;
            const pz = positions[i + 2]!;
            const dx = px - midX;
            const dy = py - midY;
            const d = dx * nx + dy * ny;
            if (d < 0) {
                positions[i] = px - d * nx * 0.85;
                positions[i + 1] = py - d * ny * 0.85;
                positions[i + 2] = pz;
            }
        }
    }

    for (const v of vertexOverrides) {
        const i = v.index * 3;
        if (i >= 0 && i < positions.length - 2) {
            positions[i] = v.x;
            positions[i + 1] = v.y;
            positions[i + 2] = v.z;
        }
    }

    return { positions, indices: payload.indices ? new Uint32Array(payload.indices) : null };
}
