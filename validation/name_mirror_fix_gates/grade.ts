// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BufferGeometry } from "three";
import { hasActiveComposedTextMarking } from "@/lib/geometry/text-marking/compose";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { extractHostTextContext, placeBottomText } from "@/lib/geometry/text-marking/place";
import type { FlattenedText, TextMarking } from "@/lib/geometry/text-marking/types";
import type { Side } from "@/types";
import { beltGcodePoint } from "./camera";
import { soleGeometry } from "./host";
import {
    type GateResult,
    type GlyphPoint,
    gradeG1,
    gradeG2,
    gradeG3,
    gradeG4,
    gradeOutsideGeometry,
    leadingGlyphIndex,
    type NameMarking,
    type PlacedName,
    pointInAabb,
    textRegion,
} from "./measure";
import { SKEW_INSET_RATIO_BASE, SYNTHETIC_NAME } from "./thresholds";

export interface FootPlacement {
    side: Side;
    flat: FlattenedText;
    placed: ReturnType<typeof placeBottomText>;
    marking: TextMarking;
}

export interface GradeInput {
    feet: FootPlacement[];
    geometry: { pass: boolean; differing: number; maxMm: number };
    gcode: { pass: boolean; outsideBase: number; outsideCandidate: number };
    files: readonly string[];
    diffText: string;
    soleBottomMaxAbsZmm: number;
    noText: { sameBytes: boolean; baseHash: string; candidateHash: string };
}

export function productionMarking(): TextMarking {
    return { ...defaultTextMarking("bottom"), text: SYNTHETIC_NAME };
}

export async function placeBeltName(
    side: Side,
    marking: TextMarking = productionMarking(),
): Promise<FootPlacement> {
    const font = await loadTextFont();
    const flat = flattenText(font, marking.text, marking.capHeightMm, marking.letterSpacingMm, marking.bold);
    const geo = soleGeometry(side);
    const ctx = extractHostTextContext(geo);
    const placed = placeBottomText(geo, ctx, marking, flat, side, { beltPrint: true });
    geo.dispose();
    return { side, flat, placed, marking };
}

function toMarking(marking: TextMarking): NameMarking {
    return {
        text: marking.text,
        surface: marking.surface,
        mode: marking.mode,
        depthMm: marking.depthMm,
        capHeightMm: marking.capHeightMm,
        rotationDeg: marking.rotationDeg,
        placementU: marking.placementU,
        nudgeAlongMm: marking.nudgeAlongMm ?? 0,
        nudgeAcrossMm: marking.nudgeAcrossMm ?? 0,
        bold: marking.bold,
    };
}

function toPlaced(foot: FootPlacement): PlacedName {
    return {
        groups: foot.placed.flat.groups.map((group) => ({ outer: group.outer })),
        centroids: foot.placed.meta.centroids,
        mappedWidthMm: foot.placed.meta.mappedWidthMm,
    };
}

function jayOuters(foot: FootPlacement): { flatOuter: GlyphPoint[]; placedOuter: GlyphPoint[] } {
    const index = leadingGlyphIndex(foot.flat.centroids);
    return {
        flatOuter: foot.flat.groups[index]?.outer ?? [],
        placedOuter: foot.placed.flat.groups[index]?.outer ?? [],
    };
}

function localPivot(foot: FootPlacement): GlyphPoint {
    return { x: foot.flat.advanceMm / 2, y: foot.flat.capHeightMm / 2 };
}

export function gradePlacement(feet: FootPlacement[]): { g1: GateResult; g2: GateResult } {
    const g1 = gradeG1(
        feet.map((foot) => {
            const jay = jayOuters(foot);
            return {
                side: foot.side,
                flatOuter: jay.flatOuter,
                placedOuter: jay.placedOuter,
                flatCentroids: foot.flat.centroids,
                placedCentroids: foot.placed.meta.centroids,
            };
        }),
    );
    const g2 = gradeG2(
        toMarking(feet[0]!.marking),
        toPlaced(feet[0]!),
        feet[0]!.flat.centroids,
        localPivot(feet[0]!),
    );
    const right = gradeG2(
        toMarking(feet[1]!.marking),
        toPlaced(feet[1]!),
        feet[1]!.flat.centroids,
        localPivot(feet[1]!),
    );
    if (!right.pass) {
        g2.pass = false;
        g2.failures.push(...right.failures.map((line) => `right ${line}`));
    }
    return { g1, g2 };
}

export function glyphPoints(feet: FootPlacement[]): GlyphPoint[] {
    const points: GlyphPoint[] = [];
    for (const foot of feet) {
        for (const group of foot.placed.flat.groups) {
            points.push(...group.outer);
        }
    }
    return points;
}

/** Identity gcode: heel and toe travel plus one point per glyph centroid. */
export function identityGcode(feet: FootPlacement[]): string[] {
    const lines: string[] = [];
    const emit = (x: number, y: number, z: number, tag: string) => {
        const g = beltGcodePoint({ x, y, z });
        lines.push(
            `G1 X${g.x.toFixed(3)} Y${g.y.toFixed(3)} Z${g.z.toFixed(3)} ; mesh ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)} ${tag}`,
        );
    };
    emit(10, -45, 0, "heel");
    emit(250, 0, 0, "toe");
    for (const foot of feet) {
        foot.placed.meta.centroids.forEach((c, index) => {
            emit(c.x, c.y, 0, `${foot.side}-glyph-${index}`);
        });
    }
    return lines;
}

export function meshOfGcodeLine(line: string): { x: number; y: number } | null {
    const match = line.match(/; mesh ([-\d.]+) ([-\d.]+)/);
    if (!match) return null;
    return { x: Number(match[1]), y: Number(match[2]) };
}

export function hashPositions(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

export function emptyDesignMarking(): TextMarking {
    return { ...defaultTextMarking("bottom"), text: "", addPatientName: false };
}

export function noTextIsInactive(marking: TextMarking): boolean {
    return (
        !hasActiveComposedTextMarking(marking, null, "left") &&
        !hasActiveComposedTextMarking(marking, null, "right")
    );
}

export async function noTextGeometryBytes(
    marking: TextMarking,
): Promise<{ sameRef: boolean; hash: string; bytes: Buffer }> {
    const { applyTextMarkingToPrintSolid } = await import("@/lib/geometry/text-marking/apply");
    const host = soleGeometry("left");
    const before = Buffer.from((host.getAttribute("position").array as Float32Array).slice());
    const out = await applyTextMarkingToPrintSolid(host, marking, { side: "left", beltPrint: true }, null);
    const after = Buffer.from((out.getAttribute("position").array as Float32Array).slice());
    const sameRef = out === host && before.equals(after);
    if (out !== host) out.dispose();
    host.dispose();
    return { sameRef, hash: hashPositions(before), bytes: before };
}

export function readSkewInsetSource(): string {
    return readFileSync(
        resolve(process.cwd(), "vertex/src/lib/geometry/procedural-wall/station-gates.ts"),
        "utf8",
    );
}

export function skewInsetOnDisk(): number | null {
    const match = readSkewInsetSource().match(/export const SKEW_INSET_RATIO = ([0-9.]+);/);
    return match ? Number(match[1]) : null;
}

export function gradeAll(input: GradeInput): GateResult[] {
    const { g1, g2 } = gradePlacement(input.feet);
    const g3 = gradeG3({
        geometry: input.geometry,
        gcode: input.gcode,
        files: input.files,
        diffText: input.diffText,
        soleBottomMaxAbsZmm: input.soleBottomMaxAbsZmm,
    });
    const g4 = gradeG4(input.noText);
    return [g1, g2, g3, g4];
}

export function identityGeometryReport(
    base: BufferGeometry,
    candidate: BufferGeometry,
    glyphs: GlyphPoint[],
) {
    const region = textRegion(glyphs);
    const basePos = base.getAttribute("position").array as Float32Array;
    const candPos = candidate.getAttribute("position").array as Float32Array;
    const inside = (index: number) =>
        pointInAabb(basePos[index * 3] ?? 0, basePos[index * 3 + 1] ?? 0, region);
    return gradeOutsideGeometry(basePos, candPos, inside);
}

export function assertBaseCap(): void {
    if (skewInsetOnDisk() !== SKEW_INSET_RATIO_BASE) {
        throw new Error(`SKEW_INSET_RATIO on disk is ${skewInsetOnDisk()}, frozen ${SKEW_INSET_RATIO_BASE}`);
    }
}
