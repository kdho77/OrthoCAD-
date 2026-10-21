// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { sha256Hex } from "@/lib/geometry/procedural-wall/sha256";
import { buildContourPass } from "./contour";
import { dropCutterZ } from "./drop-cutter";
import { CncGcodeEmitter } from "./gcode";
import { machineXY, type PartPlacement, placeWorkpieces } from "./placement";
import { toolRadiusMm } from "./profile";
import { planCenterSpiral, type XyPoint, zigzagXy } from "./spiral";
import {
    CncExportError,
    type CncJobResult,
    type CncWorkpiece,
    type MillingProfile,
    type PlacedPart,
    type Point,
} from "./types";

function toolLabel(type: "ball" | "flat", dia: number): string {
    return `${dia}mm ${type}`;
}

function changeComment(profile: MillingProfile): string {
    const d = profile.contourCutter.diameterMm;
    const kind = profile.contourCutter.type === "ball" ? "BALL" : "FLAT";
    return `CHANGE TO ${d}MM ${kind} END MILL - RE-ZERO Z`;
}

function canonicalHash(profile: MillingProfile, parts: CncWorkpiece[]): string {
    const payload = JSON.stringify({
        profile: profile.id,
        name: profile.name,
        heel: profile.heelDirection,
        topOffset: profile.topOffsetMm,
        contour: profile.contourCutter,
        tool: profile.toolpathCutter,
        parts: parts.map((p) => ({
            side: p.side,
            zMin: +p.zMin.toFixed(4),
            zMax: +p.zMax.toFixed(4),
            outline: p.outline.map((q) => [+q.x.toFixed(3), +q.y.toFixed(3)]),
        })),
    });
    return sha256Hex(payload);
}

/**
 * Linear G1 chords sit below the drop envelope by about L²/(8r).
 * Keep that sagitta under 0.004 mm for an r = 5 mm ball (L ≤ 0.4 mm).
 */
const FINISH_CHORD_MM = 0.4;

function densifyXy(pts: XyPoint[], maxChord: number): XyPoint[] {
    if (pts.length < 2) return pts;
    const out: XyPoint[] = [pts[0]!];
    for (let i = 1; i < pts.length; i++) {
        const a = out[out.length - 1]!;
        const b = pts[i]!;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.ceil(dist / maxChord));
        for (let k = 1; k <= n; k++) {
            const t = k / n;
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    return out;
}

/** Center entry stays at or under 15°. tan(15°) ≈ 0.268. */
const ENTRY_SLOPE = Math.tan((15 * Math.PI) / 180) * 0.999;
const ENTRY_DEPTH_WARN_MM = 25;

function emitEntryRamp(
    g: CncGcodeEmitter,
    placed: PlacedPart,
    profile: MillingProfile,
    circuit: XyPoint[],
    dropAt: (p: XyPoint) => number,
    zTarget: number,
): void {
    const feeds = profile.topFeeds;
    if (circuit.length < 2) return;
    let z = profile.freeMovementHeightMm;
    for (let guard = 0; guard < 8000; guard++) {
        let descended = false;
        for (let i = 1; i < circuit.length; i++) {
            const prev = circuit[i - 1]!;
            const b = circuit[i]!;
            const dist = Math.hypot(b.x - prev.x, b.y - prev.y);
            const drop = dropAt(b);
            const proposed = z - dist * ENTRY_SLOPE;
            const zNext = Math.max(proposed, drop);
            const w = machineXY(b, placed, profile);
            g.cutTo(w.x, w.y, zNext, "dip", feeds);
            if (zNext < z - 1e-4) descended = true;
            z = zNext;
        }
        if (z <= zTarget + 0.02) break;
        if (!descended) break;
    }
}

function emitContour(g: CncGcodeEmitter, placed: PlacedPart, profile: MillingProfile): string[] {
    const pass = buildContourPass(placed.outline, profile);
    const feeds = profile.topFeeds;
    const clear = profile.freeMovementHeightMm;
    const map = (p: Point) => {
        const w = machineXY(p, placed, profile);
        return { x: w.x, y: w.y, z: p.z ?? 0 };
    };
    const lead = pass.leadIn.map(map);
    if (lead.length) {
        const p0 = lead[0]!;
        g.rapidZ(clear);
        g.rapidTo(p0.x, p0.y, clear);
        g.cutTo(p0.x, p0.y, p0.z, "contour", feeds);
        for (let i = 1; i < lead.length; i++) {
            const p = lead[i]!;
            g.cutTo(p.x, p.y, p.z, "contour", feeds);
        }
    }
    for (const p of pass.helix.map(map)) g.cutTo(p.x, p.y, p.z, "contour", feeds);
    for (const p of pass.finish.map(map)) g.cutTo(p.x, p.y, p.z, "contour", feeds);
    for (const w of pass.warnings) {
        if (w.startsWith("uncut corner")) g.comment(w);
    }
    for (const p of pass.leadOut.map(map)) g.cutTo(p.x, p.y, p.z, "contour", feeds);
    g.rapidZ(clear);
    return pass.warnings;
}

function sideRank(side: string): number {
    if (side === "left") return 0;
    if (side === "right") return 1;
    return 2;
}

function toolsDiffer(profile: MillingProfile): boolean {
    return (
        profile.toolpathCutter.type !== profile.contourCutter.type ||
        profile.toolpathCutter.diameterMm !== profile.contourCutter.diameterMm
    );
}

export function generateCncJob(
    profile: MillingProfile,
    parts: CncWorkpiece[],
    options?: { placements?: PartPlacement[] },
): CncJobResult {
    for (const part of parts) {
        if (part.outline.length < 3) {
            throw new CncExportError(
                "outline_open",
                `Insole outline is not closed (points=${part.outline.length})`,
            );
        }
    }
    const placed = placeWorkpieces(profile, parts, options?.placements ?? []);
    const designHash = canonicalHash(profile, parts);
    const warnings: string[] = [];
    const g = new CncGcodeEmitter(profile);
    const feet = parts.map((p) => p.side).join("+");
    g.comment(profile.name);
    g.comment(`design-hash: ${designHash}`);
    g.comment(`foot: ${feet}`);
    g.comment(`pass1-tool: ${toolLabel(profile.toolpathCutter.type, profile.toolpathCutter.diameterMm)}`);
    g.comment(`pass2-tool: ${toolLabel(profile.contourCutter.type, profile.contourCutter.diameterMm)}`);
    if (profile.contourCutter.type === "ball") {
        const r = toolRadiusMm(profile.contourCutter.diameterMm);
        g.comment(
            `lowest ${r} mm of the wall will be filleted (${profile.contourCutter.diameterMm} mm ball)`,
        );
    }
    g.comment("box knife follows the outline (knife line), not the slot bottom");
    if (!toolsDiffer(profile)) {
        g.comment(
            `tool-change: none (same ${profile.toolpathCutter.diameterMm}mm ${profile.toolpathCutter.type} both passes)`,
        );
    }
    g.comment(`est-time: pending`);
    g.modal();
    const clear = profile.freeMovementHeightMm;
    g.rapidTo(0, 0, clear);
    g.spindle(true, profile.toolpathCutter.rpm);
    g.dwell(3);

    const ordered = placed.slice().sort((a, b) => sideRank(a.side) - sideRank(b.side));
    g.raw(profile.customGcode.toolpathStart);
    for (const part of ordered) {
        g.comment(`surface ${part.side}`);
        const tipR = toolRadiusMm(profile.toolpathCutter.diameterMm);
        const tipType = profile.toolpathCutter.type;
        const dropAt = (p: XyPoint) => dropCutterZ(part.heightmap, p.x, p.y, tipR, tipType);
        const xy =
            profile.strategy === "zigzag"
                ? zigzagXy(part.outline, profile, tipType).map((p, i) => ({
                      ...p,
                      offsetIndex: i,
                      component: 0,
                      componentStart: i === 0,
                  }))
                : planCenterSpiral(part.outline, profile, tipType);
        if (!Array.isArray(xy) && xy.warnings.length) {
            for (const w of xy.warnings) warnings.push(`${part.side}: ${w}`);
        }
        const entry = Array.isArray(xy)
            ? densifyXy(xy.slice(0, Math.min(xy.length, 8)).concat(xy.slice(0, 1)), 0.8)
            : xy.entry;
        const raw = Array.isArray(xy) ? xy : xy.samples;
        const path = densifyXy(raw, FINISH_CHORD_MM)
            .map((p) => ({ x: p.x, y: p.y, z: dropAt(p) }))
            .filter((p) => Number.isFinite(p.z));
        if (path.length < 2) continue;
        const start = path[0]!;
        const depth = profile.materialHeightMm - start.z;
        if (depth > ENTRY_DEPTH_WARN_MM) {
            const msg = `entry depth ${depth.toFixed(2)} mm exceeds 25 mm`;
            warnings.push(`${part.side}: ${msg}`);
            console.warn(`[cnc] ${msg}`);
        }
        const m0 = machineXY(start, part, profile);
        g.rapidZ(clear);
        g.rapidTo(m0.x, m0.y, clear);
        const circuit = entry.length >= 2 ? entry : [start, start];
        emitEntryRamp(g, part, profile, circuit, dropAt, start.z);
        const feeds = profile.topFeeds;
        for (const p of path) {
            const w = machineXY(p, part, profile);
            g.cutTo(w.x, w.y, p.z, "normal", feeds);
        }
        g.rapidZ(clear);
    }
    g.raw(profile.customGcode.toolpathEnd);

    if (profile.contourEnabled) {
        if (toolsDiffer(profile)) {
            g.rapidZ(clear);
            g.spindle(false, 0);
            g.pause(changeComment(profile));
            g.spindle(true, profile.contourCutter.rpm);
            g.dwell(3);
        }
        g.raw(profile.customGcode.contourStart);
        for (const part of ordered) {
            g.comment(`perimeter ${part.side}`);
            warnings.push(...emitContour(g, part, profile));
        }
        g.raw(profile.customGcode.contourEnd);
    }

    g.raw(profile.customGcode.bottomStart);
    g.raw(profile.customGcode.bottomEnd);

    g.rapidZ(clear);
    g.spindle(false, 0);
    g.rapidTo(0, 0, clear);
    g.end();

    const stats = g.stats();
    const text = g
        .toString()
        .replace("; est-time: pending", `; est-time: ${stats.estimatedTimeSec.toFixed(1)}s`);
    return { gcode: text, moves: g.moves, designHash, warnings, stats, placed };
}
