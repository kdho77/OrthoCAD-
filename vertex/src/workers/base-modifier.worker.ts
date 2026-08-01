// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";

/** Serializable height-field payload (no function fields). */
export type SerializableHeightField = Omit<HeightFieldParams, "topEdgeAvProfile" | "graph"> & {
    graph?: null;
    topEdgeAvProfile?: undefined;
};

export type BaseModifierWorkerRequest =
    | {
          type: "setBase";
          id: number;
          baseId: string;
          positions: Float32Array;
          indices: Uint32Array | null;
          userData: Record<string, unknown>;
      }
    | {
          type: "apply";
          id: number;
          baseId: string;
          field: SerializableHeightField;
          smoothingIterations: number;
          skipNormals: boolean;
          /** Optional reusable output buffer (same length as source). Transferred. */
          outPositions?: Float32Array;
      }
    | { type: "dispose"; id: number; baseId?: string };

export type BaseModifierWorkerResponse =
    | { type: "ready"; id: number; baseId: string; vertexCount: number }
    | {
          type: "result";
          id: number;
          baseId: string;
          positions: Float32Array;
          normals: Float32Array | null;
          workerMs: number;
          triangleCount: number;
      }
    | { type: "error"; id: number; message: string };

interface CachedBase {
    /** Immutable source — positions never mutated after setBase. */
    sourceGeometry: BufferGeometry;
    /** Reusable working geometry for applyBaseModifiers target. */
    workingGeometry: BufferGeometry;
    sourcePositions: Float32Array;
    triangleCount: number;
}

const bases = new Map<string, CachedBase>();

function triangleCount(geometry: BufferGeometry): number {
    const index = geometry.getIndex();
    const pos = geometry.getAttribute("position");
    if (!pos) return 0;
    return index ? index.count / 3 : pos.count / 3;
}

function buildGeometry(
    positions: Float32Array,
    indices: Uint32Array | null,
    userData: Record<string, unknown>,
): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    if (indices) {
        geometry.setIndex(new BufferAttribute(indices, 1));
    }
    geometry.userData = { ...userData };
    return geometry;
}

self.onmessage = (event: MessageEvent<BaseModifierWorkerRequest>) => {
    const msg = event.data;
    try {
        if (msg.type === "setBase") {
            const prev = bases.get(msg.baseId);
            prev?.sourceGeometry.dispose();
            prev?.workingGeometry.dispose();

            // Keep an immutable copy of source positions for every apply.
            const sourcePositions = new Float32Array(msg.positions);
            const indices = msg.indices ? new Uint32Array(msg.indices) : null;
            const sourceGeometry = buildGeometry(
                new Float32Array(sourcePositions),
                indices ? new Uint32Array(indices) : null,
                msg.userData,
            );
            const workingGeometry = buildGeometry(
                new Float32Array(sourcePositions),
                indices ? new Uint32Array(indices) : null,
                msg.userData,
            );
            const entry: CachedBase = {
                sourceGeometry,
                workingGeometry,
                sourcePositions,
                triangleCount: triangleCount(sourceGeometry),
            };
            bases.set(msg.baseId, entry);
            (self as DedicatedWorkerGlobalScope).postMessage({
                type: "ready",
                id: msg.id,
                baseId: msg.baseId,
                vertexCount: sourcePositions.length / 3,
            } satisfies BaseModifierWorkerResponse);
            return;
        }

        if (msg.type === "dispose") {
            if (msg.baseId) {
                const b = bases.get(msg.baseId);
                b?.sourceGeometry.dispose();
                b?.workingGeometry.dispose();
                bases.delete(msg.baseId);
            } else {
                for (const b of bases.values()) {
                    b.sourceGeometry.dispose();
                    b.workingGeometry.dispose();
                }
                bases.clear();
            }
            return;
        }

        if (msg.type === "apply") {
            const cached = bases.get(msg.baseId);
            if (!cached) {
                (self as DedicatedWorkerGlobalScope).postMessage({
                    type: "error",
                    id: msg.id,
                    message: `Unknown baseId ${msg.baseId}`,
                } satisfies BaseModifierWorkerResponse);
                return;
            }

            const t0 = performance.now();
            const field = msg.field as HeightFieldParams;
            // Source stays immutable; working buffer receives the deform result.
            applyBaseModifiers(cached.sourceGeometry, field, msg.smoothingIterations, {
                target: cached.workingGeometry,
                skipNormals: msg.skipNormals,
            });

            const posOut = cached.workingGeometry.getAttribute("position");
            if (!posOut) {
                (self as DedicatedWorkerGlobalScope).postMessage({
                    type: "error",
                    id: msg.id,
                    message: "Working geometry missing position attribute",
                } satisfies BaseModifierWorkerResponse);
                return;
            }
            const deformed = posOut.array as Float32Array;
            // Transfer a copy (or reuse caller-provided out buffer) so the cached
            // source + working attribute stay intact for the next apply.
            const out =
                msg.outPositions && msg.outPositions.length === deformed.length
                    ? msg.outPositions
                    : new Float32Array(deformed.length);
            out.set(deformed);

            let normals: Float32Array | null = null;
            if (!msg.skipNormals) {
                const nAttr = cached.workingGeometry.getAttribute("normal");
                if (nAttr) normals = new Float32Array(nAttr.array as Float32Array);
            }

            const workerMs = performance.now() - t0;
            const transfer: Transferable[] = [out.buffer];
            if (normals) transfer.push(normals.buffer);

            (self as DedicatedWorkerGlobalScope).postMessage(
                {
                    type: "result",
                    id: msg.id,
                    baseId: msg.baseId,
                    positions: out,
                    normals,
                    workerMs,
                    triangleCount: cached.triangleCount,
                } satisfies BaseModifierWorkerResponse,
                transfer,
            );
            return;
        }
    } catch (e) {
        (self as DedicatedWorkerGlobalScope).postMessage({
            type: "error",
            id: msg.id,
            message: e instanceof Error ? e.message : String(e),
        } satisfies BaseModifierWorkerResponse);
    }
};
