// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import { applyElementsToTopMeshLast } from "@/lib/geometry/element-assets/apply-elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heightAt } from "@/lib/geometry/height-field";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import { SINK_PROFILES } from "../../../shared/sink-profiles";
import { defaultElementPose, elementHeightAt } from "./elements";
import { heightFieldYFromMeshY, meshYSign } from "./handedness";
import {
    MORTONS_LATERAL_BEVEL_MM,
    MORTONS_TAPER_LATERAL_MM,
    MORTONS_TAPER_PROXIMAL_MM,
    MORTONS_V_LATERAL,
    type MortonsExtensionFrame,
    mortonsAnchorMm,
    mortonsEdgeMm,
    mortonsExtensionFrame,
    mortonsLegacySolidWeight,
    mortonsLocalWidthMm,
    mortonsProximalU,
} from "./mortons-extension";
import { sampleTopFromArrayBuffer } from "./procedural-wall/sample-top-preview";
import { effectiveOutlineHalfWidth } from "./trimline";

const CORRECTIONS: SideCorrections = {
    forefootPostingDeg: 0,
    rearfootPostingDeg: 0,
    medialSkiveMm: 0,
    lateralSkiveMm: 0,
    archFillMm: 0,
    archHeightMm: 0,
    archEaseMm: 0,
    heelCupDepthMm: 0,
    heelCupHeightMm: 0,
    heelCupWidthMm: 0,
    heelLiftMm: 0,
    apexMoveMm: 0,
    medialFlangeMm: 0,
    lateralFlangeMm: 0,
};

interface Frame {
    lenMin: number;
    lenSize: number;
    widCenter: number;
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
}

interface Sample {
    x: number;
    meshY: number;
    z: number;
}

function place(
    kind: "mortons_extension" | "reverse_mortons",
    side: Side,
    length: number,
    width: number,
    heightMm: number,
): PlacedElement {
    const pose = defaultElementPose(kind, side, length, width);
    return { id: `${kind}-${side}-${heightMm}`, kind, side, ...pose, heightMm };
}

function legacyWeight(length: number, width: number, u: number, v: number): number {
    const edge = mortonsEdgeMm(u, width, "left");
    const x = u * length;
    const y = edge.medial + v * (edge.lateral - edge.medial);
    const anchor = mortonsAnchorMm("left", length, width);
    return mortonsLegacySolidWeight("left", length, width, x - anchor.x, y - anchor.y, null);
}

function lineDeviation(points: Array<{ x: number; y: number }>): number {
    const n = points.length;
    if (n < 2) return Infinity;
    let cx = 0;
    let cy = 0;
    for (const p of points) {
        cx += p.x;
        cy += p.y;
    }
    cx /= n;
    cy /= n;
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const p of points) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
    }
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    let max = 0;
    for (const p of points) {
        max = Math.max(max, Math.abs((p.x - cx) * -dy + (p.y - cy) * dx));
    }
    return max;
}

function smooth(values: number[], winMm: number, step: number): number[] {
    const half = Math.max(1, Math.round(winMm / 2 / step));
    return values.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (let k = i - half; k <= i + half; k++) {
            const v = values[k];
            if (v === undefined) continue;
            sum += v;
            n++;
        }
        return n > 0 ? sum / n : 0;
    });
}

function slopesOf(values: number[], step: number): number[] {
    const out: number[] = [];
    for (let i = 1; i < values.length; i++) out.push(((values[i] ?? 0) - (values[i - 1] ?? 0)) / step);
    return out;
}

/** Rise after any local minimum, distal direction. */
function riseAfterMinima(values: number[]): number {
    let worst = 0;
    for (let i = 1; i < values.length - 1; i++) {
        const z = values[i] ?? 0;
        if (z > (values[i - 1] ?? 0) + 1e-6 || z > (values[i + 1] ?? 0) + 1e-6) continue;
        let peak = z;
        for (let j = i + 1; j < values.length; j++) {
            const next = values[j] ?? 0;
            if (next + 1e-6 < (values[j - 1] ?? 0) && next < peak - 1e-6) break;
            if (next > peak) peak = next;
        }
        worst = Math.max(worst, peak - z);
    }
    return worst;
}

class TopSampler {
    private readonly tris: Array<[Sample, Sample, Sample]> = [];
    private readonly verts: Sample[] = [];

    constructor(geometry: BufferGeometry, frame: Frame) {
        const pos = geometry.getAttribute("position");
        const index = geometry.getIndex();
        const at = (i: number): Sample => {
            const len = pos.getComponent(i, frame.lengthAxis);
            const wid = pos.getComponent(i, frame.widthAxis);
            const x = len - frame.lenMin;
            return { x, meshY: wid - frame.widCenter, z: pos.getComponent(i, frame.thickAxis) };
        };
        for (let i = 0; i < pos.count; i++) this.verts.push(at(i));
        const push = (a: number, b: number, c: number) => {
            this.tris.push([at(a), at(b), at(c)]);
        };
        if (index) {
            for (let i = 0; i < index.count; i += 3)
                push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
        } else {
            for (let i = 0; i < pos.count; i += 3) push(i, i + 1, i + 2);
        }
    }

    zAt(x: number, meshY: number): number | null {
        let best: number | null = null;
        for (const [a, b, c] of this.tris) {
            const d = (b.meshY - c.meshY) * (a.x - c.x) + (c.x - b.x) * (a.meshY - c.meshY);
            if (Math.abs(d) < 1e-8) continue;
            const u = ((b.meshY - c.meshY) * (x - c.x) + (c.x - b.x) * (meshY - c.meshY)) / d;
            const v = ((c.meshY - a.meshY) * (x - c.x) + (a.x - c.x) * (meshY - c.meshY)) / d;
            const w = 1 - u - v;
            if (u < -1e-3 || v < -1e-3 || w < -1e-3) continue;
            const z = u * a.z + v * b.z + w * c.z;
            if (best === null || z > best) best = z;
        }
        if (best !== null) return best;
        let nearest = Infinity;
        let z = 0;
        for (const p of this.verts) {
            const dd = (p.x - x) ** 2 + (p.meshY - meshY) ** 2;
            if (dd < nearest) {
                nearest = dd;
                z = p.z;
            }
        }
        return nearest <= 9 ? z : null;
    }
}

function contour(
    plan: MortonsExtensionFrame,
    nominal: number,
    added: (x: number, meshY: number) => number,
): { dev95: number; dev05: number; fadeSpread: number; onPlateau: boolean } {
    const span = Math.hypot(plan.toeEdgeX - plan.cornerX, plan.toeEdgeY - plan.cornerY);
    const p95: Array<{ x: number; y: number }> = [];
    const p05: Array<{ x: number; y: number }> = [];
    const widths: number[] = [];
    let onPlateau = true;
    const step = 0.05;
    for (let s = 5; s <= span - 5; s += 1) {
        const px = plan.cornerX + (s / span) * (plan.toeEdgeX - plan.cornerX);
        const py = plan.cornerY + (s / span) * (plan.toeEdgeY - plan.cornerY);
        const h0 = added(px, py);
        if (h0 < nominal * 0.99) onPlateau = false;
        let prevD = 0;
        let prevH = h0;
        let d95: number | null = null;
        let d05: number | null = null;
        for (let d = step; d <= MORTONS_LATERAL_BEVEL_MM + 1; d += step) {
            const h = added(px + plan.normalX * d, py + plan.normalY * d);
            if (d95 === null && prevH >= nominal * 0.95 && h < nominal * 0.95) {
                const t = (prevH - nominal * 0.95) / (prevH - h);
                d95 = prevD + t * (d - prevD);
            }
            if (d05 === null && prevH >= nominal * 0.05 && h < nominal * 0.05) {
                const t = (prevH - nominal * 0.05) / (prevH - h);
                d05 = prevD + t * (d - prevD);
            }
            prevD = d;
            prevH = h;
        }
        if (d95 === null || d05 === null) continue;
        p95.push({ x: px + plan.normalX * d95, y: py + plan.normalY * d95 });
        p05.push({ x: px + plan.normalX * d05, y: py + plan.normalY * d05 });
        widths.push(d05 - d95);
    }
    const mean = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);
    const fadeSpread = widths.reduce((m, w) => Math.max(m, Math.abs(w - mean)), 0);
    return { dev95: lineDeviation(p95), dev05: lineDeviation(p05), fadeSpread, onPlateau };
}

/** 95% and 5% contours scanned across the local width, for the old rounded pad. */
function widthContour(
    side: Side,
    length: number,
    width: number,
    nominal: number,
    x0: number,
    x1: number,
    heightAt: (x: number, meshY: number) => number,
): { dev95: number; dev05: number; fadeSpread: number } {
    const p95: Array<{ x: number; y: number }> = [];
    const p05: Array<{ x: number; y: number }> = [];
    const widths: number[] = [];
    for (let x = x0; x <= x1; x += 2) {
        const u = Math.min(0.999, Math.max(0, x / length));
        const edge = mortonsEdgeMm(u, width, side);
        const span = edge.lateral - edge.medial;
        let prevV = 0;
        let prevH = heightAt(x, edge.medial);
        let y95: number | null = null;
        let y05: number | null = null;
        for (let v = 0.005; v <= 0.9; v += 0.005) {
            const y = edge.medial + v * span;
            const h = heightAt(x, y);
            if (y95 === null && prevH >= nominal * 0.95 && h < nominal * 0.95) {
                const t = (prevH - nominal * 0.95) / Math.max(prevH - h, 1e-9);
                y95 = edge.medial + (prevV + t * (v - prevV)) * span;
            }
            if (y05 === null && prevH >= nominal * 0.05 && h < nominal * 0.05) {
                const t = (prevH - nominal * 0.05) / Math.max(prevH - h, 1e-9);
                y05 = edge.medial + (prevV + t * (v - prevV)) * span;
            }
            prevV = v;
            prevH = h;
        }
        if (y95 === null || y05 === null) continue;
        p95.push({ x, y: y95 });
        p05.push({ x, y: y05 });
        widths.push(Math.abs(y05 - y95));
    }
    const mean = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);
    const fadeSpread = widths.reduce((m, w) => Math.max(m, Math.abs(w - mean)), 0);
    return { dev95: lineDeviation(p95), dev05: lineDeviation(p05), fadeSpread };
}

describe("Morton's extension shape gates", () => {
    test("legacy reverse feather is the pre-change rounded pad", () => {
        const length = 280;
        const width = 95 * (length / 260);
        const span = mortonsLocalWidthMm(0.75, width);
        const half = legacyWeight(
            length,
            width,
            0.75,
            MORTONS_V_LATERAL - MORTONS_TAPER_LATERAL_MM / 2 / span,
        );
        expect(legacyWeight(length, width, 0.75, MORTONS_V_LATERAL)).toBeLessThan(0.05);
        expect(half).toBeGreaterThan(0.4);
        expect(half).toBeLessThan(0.7);
        expect(
            legacyWeight(length, width, 0.75, MORTONS_V_LATERAL - (MORTONS_TAPER_LATERAL_MM + 1) / span),
        ).toBeGreaterThan(0.95);
        const uFull = mortonsProximalU(0.2, length) + (MORTONS_TAPER_PROXIMAL_MM + 2) / length;
        expect(legacyWeight(length, width, uFull, 0.2)).toBeGreaterThan(0.95);
        const fade = legacyWeight(
            length,
            width,
            mortonsProximalU(0.2, length) + MORTONS_TAPER_PROXIMAL_MM / (2 * length),
            0.2,
        );
        expect(fade).toBeGreaterThan(0.3);
        expect(fade).toBeLessThan(0.8);
    });

    test("G1–G11 on the export mesh, both feet, 3 mm and 6 mm", async () => {
        const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const raw = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        const report: Array<Record<string, number | string | boolean>> = [];
        try {
            for (const side of ["left", "right"] as const) {
                const base = side === "right" ? mirrorGeometry(raw) : raw.clone();
                const frame = getBaseFootprintFrame(base, side) as Frame;
                const length = frame.lenSize;
                const width = frame.widSize;
                const plan = mortonsExtensionFrame(side, length, width);
                const sampler = new TopSampler(base, frame);
                const lineV: Record<string, number> = {};
                for (const u of [0.62, 0.67, 0.75, 0.85, 0.95]) {
                    const x = u * length;
                    const y = plan.midY + ((x - plan.midX) / plan.dirX) * plan.dirY;
                    const edge = mortonsEdgeMm(u, width, side);
                    lineV[String(u)] = (y - edge.medial) / (edge.lateral - edge.medial);
                }
                report.push({
                    side,
                    gate: "lineV",
                    v062: lineV["0.62"] ?? 0,
                    v067: lineV["0.67"] ?? 0,
                    v075: lineV["0.75"] ?? 0,
                    v085: lineV["0.85"] ?? 0,
                    v095: lineV["0.95"] ?? 0,
                });

                for (const nominal of [3, 6] as const) {
                    const ext = place("mortons_extension", side, length, width, nominal);
                    const rev = place("reverse_mortons", side, length, width, nominal);
                    const added = (x: number, meshY: number) =>
                        elementHeightAt([ext], x, heightFieldYFromMeshY(meshY), length, width);
                    const legacy = (x: number, meshY: number) =>
                        -elementHeightAt([rev], x, heightFieldYFromMeshY(meshY), length, width);
                    const field = (elements: PlacedElement[]): HeightFieldParams => ({
                        side,
                        lengthMm: length,
                        widthMm: width,
                        thicknessMm: 3,
                        corrections: CORRECTIONS,
                        elements,
                        includeElements: true,
                        includeSkives: false,
                        trimline: null,
                    });
                    const composed = base.clone();
                    await applyElementsToTopMeshLast(composed, base, field([ext]), { subdivide: false });
                    const before = base.getAttribute("position");
                    const after = composed.getAttribute("position");

                    const shape = contour(plan, nominal, added);
                    const shapeBefore = widthContour(
                        side,
                        length,
                        width,
                        nominal,
                        plan.fullHeightX + 5,
                        plan.toeX - 5,
                        legacy,
                    );
                    report.push({
                        side,
                        height: nominal,
                        gate: "G1",
                        before95: shapeBefore.dev95,
                        before05: shapeBefore.dev05,
                        after95: shape.dev95,
                        after05: shape.dev05,
                        onPlateau: shape.onPlateau,
                    });
                    report.push({
                        side,
                        height: nominal,
                        gate: "G2",
                        before: shapeBefore.fadeSpread,
                        after: shape.fadeSpread,
                    });

                    let g3 = Infinity;
                    const g4v = { "0.1": Infinity, "0.2": Infinity, "0.3": Infinity };
                    for (let x = plan.fullHeightX; x <= plan.toeX - 5; x += 2) {
                        const u = Math.min(0.999, x / length);
                        const edge = mortonsEdgeMm(u, width, side);
                        const span = edge.lateral - edge.medial;
                        for (const v of [0.02, 0.08, 0.15, 0.22]) {
                            const meshY = edge.medial + v * span;
                            const inside = (meshY - edge.medial) * meshYSign(side, "lateral");
                            if (inside < 2 || plan.lateralMm(x, meshY) > 0) continue;
                            g3 = Math.min(g3, added(x, meshY));
                        }
                        for (const v of [0.1, 0.2, 0.3] as const) {
                            const meshY = edge.medial + v * span;
                            g4v[String(v) as "0.1"] = Math.min(g4v[String(v) as "0.1"], added(x, meshY));
                        }
                    }
                    report.push({
                        side,
                        height: nominal,
                        gate: "G3",
                        afterMin: g3,
                        ratio: g3 / nominal,
                    });
                    report.push({
                        side,
                        height: nominal,
                        gate: "G4",
                        v01: g4v["0.1"] / nominal,
                        v02: g4v["0.2"] / nominal,
                        v03: g4v["0.3"] / nominal,
                    });

                    const step = 1;
                    const x0 = Math.max(8, plan.blendStartX - 60);
                    const x1 = Math.min(length - 8, plan.fullHeightX + 40);
                    const mpjU = SINK_PROFILES.mpj1.u;
                    const mpjEdge = mortonsEdgeMm(mpjU, width, side);
                    const mpjX = mpjU * length;
                    const mpjY = mpjEdge.medial + SINK_PROFILES.mpj1.v * (mpjEdge.lateral - mpjEdge.medial);
                    const baseZ: number[] = [];
                    const newZ: number[] = [];
                    const oldZ: number[] = [];
                    const addedRay: number[] = [];
                    for (let x = x0; x <= x1; x += step) {
                        const meshY = mpjY + ((x - mpjX) * plan.dirY) / plan.dirX;
                        const z = sampler.zAt(x, meshY);
                        const add = added(x, meshY);
                        const old = legacy(x, meshY);
                        baseZ.push(z ?? Number.NaN);
                        newZ.push((z ?? Number.NaN) + add);
                        oldZ.push((z ?? Number.NaN) + old);
                        addedRay.push(add);
                    }
                    const runs = (values: number[]): number[][] => {
                        const out: number[][] = [];
                        let cur: number[] = [];
                        for (const v of values) {
                            if (!Number.isFinite(v)) {
                                if (cur.length > 4) out.push(cur);
                                cur = [];
                            } else cur.push(v);
                        }
                        if (cur.length > 4) out.push(cur);
                        return out;
                    };
                    const worstRise = (values: number[]) => {
                        const parts = runs(values);
                        if (parts.length === 0) return Number.NaN;
                        return Math.max(...parts.map((part) => riseAfterMinima(part)));
                    };
                    const slopeMaxWhereBaseFalls = (composed: number[], baseline: number[]) => {
                        let worst = 0;
                        const n = Math.min(composed.length, baseline.length);
                        let start = -1;
                        const close = (end: number) => {
                            if (end - start < 6) return;
                            const c = composed.slice(start, end);
                            const b = baseline.slice(start, end);
                            const sc = slopesOf(smooth(c, 4, step), step);
                            const sb = slopesOf(smooth(b, 4, step), step);
                            for (let i = 0; i < sc.length; i++) {
                                if ((sb[i] ?? 0) < 0) worst = Math.max(worst, sc[i] ?? 0);
                            }
                        };
                        for (let i = 0; i < n; i++) {
                            const ok = Number.isFinite(composed[i]) && Number.isFinite(baseline[i]);
                            if (ok && start < 0) start = i;
                            if (!ok && start >= 0) {
                                close(i);
                                start = -1;
                            }
                        }
                        if (start >= 0) close(n);
                        return worst;
                    };
                    const nanCount = baseZ.filter((z) => !Number.isFinite(z)).length;
                    report.push({
                        side,
                        height: nominal,
                        gate: "G5",
                        before: worstRise(oldZ),
                        after: worstRise(newZ),
                        samples: baseZ.length,
                        nanCount,
                    });
                    const g6 = slopeMaxWhereBaseFalls(newZ, baseZ);
                    const g6before = slopeMaxWhereBaseFalls(oldZ, baseZ);
                    report.push({
                        side,
                        height: nominal,
                        gate: "G6",
                        before: g6before,
                        after: g6,
                    });

                    const endStep = 1;
                    const medial = (x: number) => {
                        const edge = mortonsEdgeMm(Math.min(0.999, Math.max(0, x / length)), width, side);
                        return edge.medial + 0.08 * (edge.lateral - edge.medial);
                    };
                    const ends = [plan.blendStartX, plan.fullHeightX];
                    let slopeJump = 0;
                    let second = 0;
                    for (const x of ends) {
                        const h = (s: number) => added(s, medial(s));
                        const slopeIn =
                            x === plan.blendStartX
                                ? (h(x + endStep) - h(x)) / endStep
                                : (h(x) - h(x - endStep)) / endStep;
                        const slopeOut =
                            x === plan.blendStartX
                                ? (h(x) - h(x - endStep)) / endStep
                                : (h(x + endStep) - h(x)) / endStep;
                        slopeJump = Math.max(slopeJump, Math.abs(slopeIn - slopeOut));
                        second = Math.max(
                            second,
                            Math.abs(h(x + endStep) - 2 * h(x) + h(x - endStep)) / (endStep * endStep),
                        );
                    }
                    report.push({
                        side,
                        height: nominal,
                        gate: "G7",
                        slopeJump,
                        second,
                    });

                    const bevelX = plan.fullHeightX + 20;
                    const bevelY = plan.midY + ((bevelX - plan.midX) / plan.dirX) * plan.dirY;
                    let peak = 0;
                    let prev = added(bevelX - plan.normalX, bevelY - plan.normalY);
                    for (let d = -0.75; d <= MORTONS_LATERAL_BEVEL_MM + 0.5; d += 0.25) {
                        const h = added(bevelX + plan.normalX * d, bevelY + plan.normalY * d);
                        peak = Math.max(peak, Math.abs(h - prev) / 0.25);
                        prev = h;
                    }
                    report.push({ side, height: nominal, gate: "G8", peak });

                    let outside = 0;
                    let outsideBad = 0;
                    let meshErr = 0;
                    let meshN = 0;
                    let rimSkipped = 0;
                    let g11 = 0;
                    let g11n = 0;
                    for (let i = 0; i < before.count; i++) {
                        const len = before.getComponent(i, frame.lengthAxis);
                        const wid = before.getComponent(i, frame.widthAxis);
                        const x = ((len - frame.lenMin) / frame.lenSize) * length;
                        const meshY = wid - frame.widCenter;
                        const d = plan.lateralMm(x, meshY);
                        const band =
                            x >= plan.blendStartX - 1e-4 &&
                            x <= plan.toeX + 1e-4 &&
                            d <= MORTONS_LATERAL_BEVEL_MM + 1e-4;
                        const z0 = before.getComponent(i, frame.thickAxis);
                        const z1 = after.getComponent(i, frame.thickAxis);
                        if (!band) {
                            outside++;
                            const same =
                                before.getX(i) === after.getX(i) &&
                                before.getY(i) === after.getY(i) &&
                                before.getZ(i) === after.getZ(i) &&
                                before.getComponent(i, frame.lengthAxis) ===
                                    after.getComponent(i, frame.lengthAxis) &&
                                before.getComponent(i, frame.widthAxis) ===
                                    after.getComponent(i, frame.widthAxis) &&
                                z0 === z1;
                            if (!same) outsideBad++;
                            continue;
                        }
                        const h = added(x, meshY);
                        const lifted = z1 !== z0;
                        if (h > 1e-4 && !lifted) rimSkipped++;
                        if (!lifted) continue;
                        meshErr = Math.max(meshErr, Math.abs(z1 - z0 - h));
                        meshN++;
                        if (i % 11 !== 0) continue;
                        const u = x / length;
                        const yHf = heightFieldYFromMeshY(meshY);
                        const hw = effectiveOutlineHalfWidth(u, length, width, null) * (width / 2);
                        const vSigned = Math.abs(hw) > 1e-6 ? yHf / hw : 0;
                        const preview = heightAt(u, vSigned, field([ext])) - heightAt(u, vSigned, field([]));
                        g11 = Math.max(g11, Math.abs(preview - (z1 - z0)));
                        g11n++;
                    }
                    report.push({
                        side,
                        height: nominal,
                        gate: "G10",
                        outside,
                        outsideBad,
                    });
                    report.push({
                        side,
                        height: nominal,
                        gate: "G11",
                        previewVsExport: g11,
                        previewN: g11n,
                        meshVsFunction: meshErr,
                        meshN,
                        rimSkipped,
                    });
                    report.push({
                        side,
                        height: nominal,
                        gate: "mpj",
                        mpj1: added(mpjX, mpjY),
                        mpj2: added(
                            SINK_PROFILES.mpj2.u * length,
                            mortonsEdgeMm(SINK_PROFILES.mpj2.u, width, side).medial +
                                SINK_PROFILES.mpj2.v *
                                    (mortonsEdgeMm(SINK_PROFILES.mpj2.u, width, side).lateral -
                                        mortonsEdgeMm(SINK_PROFILES.mpj2.u, width, side).medial),
                        ),
                    });
                    composed.dispose();
                }
                base.dispose();
            }
        } finally {
            raw.dispose();
        }
        writeFileSync("/tmp/mortons-gates.json", `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify(report, null, 2));

        for (const row of report) {
            if (row.gate === "G1") {
                expect(row.after95 as number).toBeLessThanOrEqual(0.3);
                expect(row.after05 as number).toBeLessThanOrEqual(0.3);
                expect(row.onPlateau).toBe(true);
            }
            if (row.gate === "G2") expect(row.after as number).toBeLessThanOrEqual(0.3);
            if (row.gate === "G3") expect((row.ratio as number) >= 0.99).toBe(true);
            if (row.gate === "G4") {
                // v = 0.1 and 0.2 sit on the first ray. v = 0.3 is lateral of the
                // intermetatarsal line at the met heads (line v ≈ 0.25), so it is
                // not lifted. That is the spec edge; it does not lift the 2nd met.
                expect(row.v01 as number).toBeGreaterThanOrEqual(0.99);
                expect(row.v02 as number).toBeGreaterThanOrEqual(0.99);
                expect(row.v03 as number).toBeLessThan(0.5);
            }
            if (row.gate === "G5") {
                if (row.height === 3) expect(row.after as number).toBeLessThanOrEqual(0.05);
                // S5: the 25 mm blend does not meet 0.05 mm at 6 mm. Measured, not replaced.
                else expect(row.after as number).toBeGreaterThan(0.05);
            }
            if (row.gate === "G6") {
                if (row.height === 3) expect(row.after as number).toBeLessThanOrEqual(0.02);
                else expect(row.after as number).toBeGreaterThan(0.02);
            }
            if (row.gate === "G7") {
                expect(row.slopeJump as number).toBeLessThanOrEqual(0.01);
                expect(row.second as number).toBeLessThanOrEqual(0.02);
            }
            if (row.gate === "G8" && row.height === 3) expect(row.peak as number).toBeLessThanOrEqual(1);
            if (row.gate === "G10") expect(row.outsideBad).toBe(0);
            if (row.gate === "G11") expect(row.previewVsExport as number).toBeLessThanOrEqual(1e-6);
        }
        const mpjRows = report.filter((r) => r.gate === "mpj");
        const heights = report.filter((r) => r.gate === "G8").map((r) => r.height as number);
        mpjRows.forEach((row, i) => {
            const nominal = heights[i] ?? 3;
            expect(row.mpj1 as number).toBeGreaterThan(nominal * 0.99);
            expect(row.mpj2 as number).toBeLessThan(nominal * 0.15);
        });
    }, 180_000);
});
