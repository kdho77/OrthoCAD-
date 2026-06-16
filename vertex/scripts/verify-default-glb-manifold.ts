// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
    closeGlbInsoleToSolid,
    extractBoundaryLoops,
    validateManifold,
    validateManifoldDetailed,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";

const DEFAULT_GLB_URL =
    "https://wstneucimlemaokoyjwh.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb";
const DEFAULT_GLB_CACHE = "/tmp/Default.glb";

async function loadDefaultGlbBuffer(): Promise<ArrayBuffer> {
    if (!existsSync(DEFAULT_GLB_CACHE)) {
        const res = await fetch(DEFAULT_GLB_URL);
        if (!res.ok) throw new Error(`Failed to download Default.glb (${res.status})`);
        writeFileSync(DEFAULT_GLB_CACHE, Buffer.from(await res.arrayBuffer()));
    }
    return readFileSync(DEFAULT_GLB_CACHE).buffer.slice(0);
}

async function main(): Promise<void> {
    const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("extractMergedGeometry returned null");

    const raw = merged.geometry;
    const pre = validateManifold(raw);
    console.log("[VERIFY] Default.glb PRE:", {
        openEdges: pre.openEdges,
        nonManifoldEdges: pre.nonManifoldEdges,
        euler: pre.eulerCharacteristic,
        isWatertight: pre.isWatertight,
    });

    const closed = closeGlbInsoleToSolid(raw.clone());
    const detailed = validateManifoldDetailed(closed, "VERIFY-FULL-MERGE");
    const post = validateManifold(closed);
    const openLoops = extractBoundaryLoops(closed);

    // List non-manifold edges for debugging
    const pos = closed.getAttribute("position");
    const idx = closed.index;
    const QUANT = 1e4;
    const key = (i: number) => {
        const x = Math.round(pos.getX(i) * QUANT);
        const y = Math.round(pos.getY(i) * QUANT);
        const z = Math.round(pos.getZ(i) * QUANT);
        return `${x},${y},${z}`;
    };
    const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const edgeCount = new Map<string, number>();
    const triCount = idx ? idx.count / 3 : 0;
    for (let t = 0; t < triCount; t++) {
        const ia = idx!.getX(t * 3);
        const ib = idx!.getX(t * 3 + 1);
        const ic = idx!.getX(t * 3 + 2);
        for (const [a, b] of [
            [key(ia), key(ib)],
            [key(ib), key(ic)],
            [key(ic), key(ia)],
        ]) {
            const e = edgeKey(a, b);
            edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
        }
    }
    const bad = [...edgeCount.entries()].filter(([, c]) => c > 2);
    if (bad.length > 0) {
        console.log("[VERIFY] non-manifold edges:", bad.slice(0, 10));
    }

    console.log("[VERIFY] Default.glb POST:", {
        openEdges: post.openEdges,
        nonManifoldEdges: post.nonManifoldEdges,
        euler: post.eulerCharacteristic,
        isWatertight: post.isWatertight,
        openLoops: openLoops.length,
    });
    console.log("[VERIFY] Default.glb DETAILED:", detailed);

    const pass =
        post.openEdges === 0 &&
        post.nonManifoldEdges === 0 &&
        post.eulerCharacteristic === 2 &&
        post.isWatertight &&
        openLoops.length === 0;

    const welded = mergeVertices(closed, 1e-4);
    const postWeld = validateManifold(welded);
    console.log("[VERIFY] after mergeVertices:", postWeld);

    console.log(pass ? "[VERIFY] ✓ MANIFOLD TARGET MET" : "[VERIFY] ✗ MANIFOLD TARGET NOT MET");
    closed.dispose();
    if (welded !== closed) welded.dispose();
    raw.dispose();
    process.exit(pass ? 0 : 1);
}

main().catch((err) => {
    console.error("[VERIFY] failed:", err);
    process.exit(1);
});
