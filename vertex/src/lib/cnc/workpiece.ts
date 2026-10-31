// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { extractOrderedBoundaryLoop } from "@/lib/geometry/mesh-close";
import type { Side } from "@/types";
import { DESIGN_PITCH_MM, SKIN_FLOOR_MM } from "./drop-cutter";
import { heightmapRange, rasterizeTop } from "./heightmap";
import { closeOutline, ensureCcw, startAtHeel } from "./polygon";
import { skinZ, toolRadiusMm } from "./profile";
import type { CncWorkpiece, MillingProfile, Point } from "./types";
import { CncExportError } from "./types";

const CLOSED_GAP_MM = 2;
/** Same weld as mesh-close quant keys. Shoe-size scale can land two vertices in one cell. */
const OUTLINE_QUANT = 1e4;

function quantKey(x: number, y: number, z: number): string {
    return `${Math.round(x * OUTLINE_QUANT)},${Math.round(y * OUTLINE_QUANT)},${Math.round(z * OUTLINE_QUANT)}`;
}

function parseQuantKey(key: string): Point {
    const [xs, ys, zs] = key.split(",");
    return {
        x: Number(xs) / OUTLINE_QUANT,
        y: Number(ys) / OUTLINE_QUANT,
        z: Number(zs) / OUTLINE_QUANT,
    };
}

/**
 * Shoe-size XY scale can quantize two corners of a boundary triangle onto one
 * key. That drops a naked edge and leaves the simple loop walker with an open
 * chain (US M 9 / 10 / 11 on SAMPLE_Top). Walk that chain and close the gap.
 * A loop the simple extractor already closed is left untouched.
 */
function repairOpenBoundary(geometry: BufferGeometry): Point[] {
    const pos = geometry.getAttribute("position");
    if (!pos) return [];
    const index = geometry.getIndex();
    const triN = index ? index.count / 3 : pos.count / 3;
    const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const edgeCount = new Map<string, number>();
    for (let t = 0; t < triN; t++) {
        const keys = [0, 1, 2].map((k) => {
            const vi = at(t, k);
            return quantKey(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        });
        for (let i = 0; i < 3; i++) {
            const a = keys[i]!;
            const b = keys[(i + 1) % 3]!;
            if (a === b) continue;
            const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
            edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1);
        }
    }
    const adj = new Map<string, string[]>();
    const link = (a: string, b: string) => {
        const list = adj.get(a);
        if (list) {
            if (!list.includes(b)) list.push(b);
        } else adj.set(a, [b]);
    };
    for (const [ek, count] of edgeCount) {
        if (count !== 1) continue;
        const bar = ek.indexOf("|");
        const a = ek.slice(0, bar);
        const b = ek.slice(bar + 1);
        link(a, b);
        link(b, a);
    }
    if (adj.size < 3) return [];
    const visited = new Set<string>();
    const edgeId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const chains: string[][] = [];
    const starts = [...adj.keys()].sort(
        (a, b) => adj.get(a)!.length - adj.get(b)!.length || (a < b ? -1 : 1),
    );
    for (const start of starts) {
        const neighbors = adj.get(start) ?? [];
        for (const next of neighbors) {
            const first = edgeId(start, next);
            if (visited.has(first)) continue;
            const chain = [start];
            let prev = start;
            let curr = next;
            visited.add(first);
            for (let guard = 0; guard < adj.size + 2; guard++) {
                chain.push(curr);
                const nxt = (adj.get(curr) ?? []).find((n) => n !== prev && !visited.has(edgeId(curr, n)));
                if (!nxt) break;
                visited.add(edgeId(curr, nxt));
                if (nxt === start) break;
                prev = curr;
                curr = nxt;
            }
            if (chain.length >= 3) chains.push(chain);
        }
    }
    let best: string[] = [];
    for (const chain of chains) if (chain.length > best.length) best = chain;
    return best.map(parseQuantKey);
}

export function outlineFromGeometry(geometry: BufferGeometry): Point[] {
    const loop = extractOrderedBoundaryLoop(geometry);
    const pts: Point[] = (loop.length >= 3 ? loop : repairOpenBoundary(geometry)).map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
    }));
    if (pts.length < 3) {
        throw new CncExportError("outline_open", `Insole outline is not closed (points=${pts.length})`);
    }
    return startAtHeel(ensureCcw(closeOutline(pts, CLOSED_GAP_MM)));
}

export function workpieceFromGeometry(
    geometry: BufferGeometry,
    side: Side,
    profile: MillingProfile,
): CncWorkpiece {
    const outline = outlineFromGeometry(geometry);
    const band =
        profile.topOffsetMm +
        Math.max(
            toolRadiusMm(profile.toolpathCutter.diameterMm),
            toolRadiusMm(profile.contourCutter.diameterMm),
        );
    const pitch = Math.min(DESIGN_PITCH_MM, Math.max(0.05, profile.sampleMm));
    const heightmap = rasterizeTop(geometry, outline, pitch, band, Math.max(SKIN_FLOOR_MM, skinZ(profile)));
    const { zMin, zMax } = heightmapRange(heightmap);
    return { side, outline, heightmap, zMin, zMax };
}
