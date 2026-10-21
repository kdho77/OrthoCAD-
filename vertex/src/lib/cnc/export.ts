// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { sha256Hex } from "@/lib/geometry/procedural-wall/sha256";
import { buildContourPass } from "./contour";
import { buildDropMap, sampleDrop } from "./drop-cutter";
import { CncGcodeEmitter } from "./gcode";
import { machineXY, type PartPlacement, placeWorkpieces } from "./placement";
import { maxStepdownMm, skinZ, toolRadiusMm } from "./profile";
import { spiralXy, waterlineLevels, zigzagXy } from "./spiral";
import {
    CncExportError,
    type CncJobResult,
    type CncWorkpiece,
    type FeedClass,
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

function plunge(g: CncGcodeEmitter, profile: MillingProfile, x: number, y: number, zTarget: number): void {
    const feeds = profile.topFeeds;
    const clear = profile.freeMovementHeightMm;
    const step = maxStepdownMm(profile);
    g.rapidZ(clear);
    g.rapidTo(x, y, clear);
    let z = clear;
    const dest = Math.max(zTarget, skinZ(profile));
    while (z > dest + 1e-6) {
        z = Math.max(dest, z - step);
        g.cutTo(x, y, z, "dip", feeds);
    }
}

function emitPath(
    g: CncGcodeEmitter,
    placed: PlacedPart,
    profile: MillingProfile,
    pts: Point[],
    feed: FeedClass,
    firstSlow: boolean,
): void {
    if (pts.length === 0) return;
    const feeds = profile.topFeeds;
    const clear = profile.freeMovementHeightMm;
    const start = machineXY(pts[0]!, placed, profile);
    const z0 = Math.max(pts[0]!.z ?? skinZ(profile), skinZ(profile));
    plunge(g, profile, start.x, start.y, z0);
    let engaged = !firstSlow;
    for (let i = 1; i < pts.length; i++) {
        const w = machineXY(pts[i]!, placed, profile);
        const z = Math.max(pts[i]!.z ?? skinZ(profile), skinZ(profile));
        const cls: FeedClass = !engaged ? "slow" : feed;
        g.cutTo(w.x, w.y, z, cls, feeds);
        engaged = true;
    }
    g.rapidZ(clear);
}

function emitContour(g: CncGcodeEmitter, placed: PlacedPart, profile: MillingProfile): string[] {
    const pass = buildContourPass(placed.outline, profile);
    const feeds = profile.topFeeds;
    const clear = profile.freeMovementHeightMm;
    const map = (p: Point) => {
        const w = machineXY(p, placed, profile);
        return { x: w.x, y: w.y, z: Math.max(p.z ?? skinZ(profile), skinZ(profile)) };
    };
    const lead = pass.leadIn.map(map);
    if (lead.length) {
        const p0 = lead[0]!;
        plunge(g, profile, p0.x, p0.y, p0.z ?? profile.materialHeightMm);
        for (let i = 1; i < lead.length; i++) {
            const p = lead[i]!;
            g.cutTo(p.x, p.y, p.z ?? profile.materialHeightMm, "slow", feeds);
        }
    }
    for (const p of pass.helix.map(map)) g.cutTo(p.x, p.y, p.z ?? skinZ(profile), "dip", feeds);
    for (const p of pass.finish.map(map)) g.cutTo(p.x, p.y, p.z ?? skinZ(profile), "contour", feeds);
    for (const w of pass.warnings) {
        if (w.startsWith("uncut corner")) g.comment(w);
    }
    const out = pass.leadOut.map(map);
    for (const p of out) g.cutTo(p.x, p.y, p.z ?? skinZ(profile), "slow", feeds);
    g.rapidZ(clear);
    return pass.warnings;
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

    g.raw(profile.customGcode.toolpathStart);
    for (const part of placed) {
        const dropMap = buildDropMap(
            part.heightmap,
            toolRadiusMm(profile.toolpathCutter.diameterMm),
            profile.toolpathCutter.type,
        );
        const xy =
            profile.strategy === "zigzag"
                ? zigzagXy(part.outline, profile, profile.toolpathCutter.type)
                : spiralXy(part.outline, profile, profile.toolpathCutter.type);
        const sampled: Array<{ x: number; y: number; drop: number }> = [];
        for (const p of xy) {
            const drop = sampleDrop(dropMap, p.x, p.y);
            if (!Number.isFinite(drop)) continue;
            sampled.push({ x: p.x, y: p.y, drop });
        }
        const levels = waterlineLevels(profile, part.zMin);
        let didFinish = false;
        for (const levelZ of [...levels, Number.NEGATIVE_INFINITY]) {
            if (didFinish) break;
            const path: Point[] = [];
            let follows = true;
            for (const p of sampled) {
                const z = Math.max(p.drop, levelZ, skinZ(profile));
                path.push({ x: p.x, y: p.y, z });
                if (z > p.drop + 0.05) follows = false;
            }
            if (path.length < 2) continue;
            emitPath(g, part, profile, path, "normal", true);
            if (follows || levelZ === Number.NEGATIVE_INFINITY) didFinish = true;
        }
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
        for (const part of placed) warnings.push(...emitContour(g, part, profile));
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
