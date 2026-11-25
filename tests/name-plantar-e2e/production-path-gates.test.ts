// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Frozen production-path gates G1–G4. Extends the #442 lock. Does not replace it.
// Thresholds in thresholds.ts are not loosened. Synthetic name only.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { printerFootStlFacts } from "@/features/exports/printer-foot-isolation";
import {
    buildFinalizedBeltPairFromSavedSettings,
    buildFinalizedFootFromSavedDesign,
    designStateFromSavedSettings,
} from "@/features/exports/saved-design-finalized-mesh";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";
import { detectGcodeFoot } from "../../vertex/server/src/lib/gcode-handedness";
import { defaultBottomTextMarking } from "../../vertex/shared/bottom-text-marking";
import { gradeObservedLoops, gradeReport } from "./grade-gcode";
import { meshPointToGcode, meshPointToReading } from "./production-frame";
import {
    CONTROL_442,
    PATH_0D3DB1C0,
    PATH_AD1E0CC5,
    PRODUCTION_PATHS,
    type ProductionPathSpec,
    designForPath,
    loftEnvelope,
} from "./production-fixtures";
import { heelEnd } from "./reading-view";
import {
    type StlTri,
    extractEngraveBlobs,
    footTriangles,
    nonTextHash,
    readStlTriangles,
    soleFacts,
    triangleHash,
} from "./stl-glyphs";
import { FROZEN_NON_TEXT_SHA256 } from "./frozen-surface-hashes";
import { SYNTHETIC_NAME } from "./thresholds";

/** Existing bottom textMarking. Not a new engraving system. */
const ENGRAVE_DEPTH_MM = 0.6;
const PLACEMENT_U = 0.32;
const CAP_HEIGHT_MM = 12;
const FLOOR_Z_TOL = 0.08;
const SOLE_MIN_Z_MAX = 0.2;
const SOLE_NEAR_ZERO_MIN = 0.04;

interface MarkingLock {
    mode: string;
    depthMm: number;
    placementU: number;
    surface: string;
    capHeightMm: number;
}

function markingFailures(marking: MarkingLock): string[] {
    const failures: string[] = [];
    if (marking.mode !== "engrave") failures.push(`mode ${marking.mode} (need engrave)`);
    if (marking.depthMm !== ENGRAVE_DEPTH_MM) failures.push(`depthMm ${marking.depthMm} (need ${ENGRAVE_DEPTH_MM})`);
    if (marking.placementU !== PLACEMENT_U) failures.push(`placementU ${marking.placementU} (need ${PLACEMENT_U})`);
    if (marking.surface !== "bottom") failures.push(`surface ${marking.surface} (need bottom)`);
    if (marking.capHeightMm !== CAP_HEIGHT_MM) failures.push(`capHeightMm ${marking.capHeightMm} (need ${CAP_HEIGHT_MM})`);
    return failures;
}

interface Cell {
    id: string;
    side: Side;
    g1Pass: boolean;
    failures: string[];
    report: Record<string, number | string | boolean>;
    foot: string;
    heelHigh: boolean | null;
    heelDeltaMm: number;
    placementU: number | null;
    floorMedianZ: number;
    soleMinZ: number;
    soleNearZero: number;
    nonTextHash: string;
    fullHash: string;
    solidTriangles: number;
    uploadTriangles: number;
    stamp: string | null;
    loops: Array<Array<{ x: number; y: number }>>;
    g3: string[];
}

function bytesOf(path: string): ArrayBuffer {
    const buf = readFileSync(path);
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return copy;
}

function g3Failures(cell: Pick<Cell, "floorMedianZ" | "soleMinZ" | "soleNearZero">): string[] {
    const failures: string[] = [];
    if (!(Math.abs(cell.floorMedianZ - ENGRAVE_DEPTH_MM) <= FLOOR_Z_TOL)) {
        failures.push(`engrave floor z ${cell.floorMedianZ} (need ${ENGRAVE_DEPTH_MM} ± ${FLOOR_Z_TOL})`);
    }
    if (!(cell.soleMinZ <= SOLE_MIN_Z_MAX)) {
        failures.push(`sole min z ${cell.soleMinZ} (plantar face is not on the belt)`);
    }
    if (!(cell.soleNearZero >= SOLE_NEAR_ZERO_MIN)) {
        failures.push(`sole contact fraction ${cell.soleNearZero} (sole is not flat on z=0)`);
    }
    return failures;
}

function handednessGcode(tris: readonly StlTri[]): string {
    const foot = footTriangles(tris);
    const lines = ["G90"];
    let e = 0;
    for (let i = 0; i < foot.length; i += 3) {
        const t = foot[i]!;
        const c = {
            x: (t.v[0].x + t.v[1].x + t.v[2].x) / 3,
            y: (t.v[0].y + t.v[1].y + t.v[2].y) / 3,
            z: (t.v[0].z + t.v[1].z + t.v[2].z) / 3,
        };
        const g = meshPointToGcode(c);
        e += 0.02;
        lines.push(`G1 X${g.x.toFixed(3)} Y${g.y.toFixed(3)} Z${g.z.toFixed(3)} E${e.toFixed(4)}`);
    }
    return lines.join("\n");
}

function mirrorLoops(loops: Array<Array<{ x: number; y: number }>>, axis: "x" | "y"): Array<Array<{ x: number; y: number }>> {
    const values = loops.flat().map((p) => p[axis]);
    const c = (Math.min(...values) + Math.max(...values)) / 2;
    return loops.map((loop) => loop.map((p) => (axis === "x" ? { x: 2 * c - p.x, y: p.y } : { x: p.x, y: 2 * c - p.y })));
}

describe("production-path plantar name gates", () => {
    test("G1–G4 on the manufacturing STL for every listed path", async () => {
        const only = process.env.NAME_CHIRALITY_ONLY;
        const specs = only ? PRODUCTION_PATHS.filter((spec) => spec.id === only || spec.id.startsWith(only)) : PRODUCTION_PATHS;
        const sampleTop = bytesOf(resolve("tests/fixtures/SAMPLE_Top.glb"));
        const fontBytes = bytesOf(resolve("vertex/public/fonts/Inter-Bold.ttf"));
        primeTextFont(fontBytes);
        const sampleFile = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        globalThis.fetch = async (input) => {
            const url = String(input);
            if (!url.includes("SAMPLE_Top")) throw new Error(`unexpected fetch ${url}`);
            return new Response(sampleFile);
        };
        const font = await (await import("@/lib/geometry/text-marking/font")).loadTextFont();
        const marking = defaultBottomTextMarking();
        expect(markingFailures(marking), "default bottom textMarking").toEqual([]);
        for (const spec of specs) {
            const saved = designForPath(spec).textMarking;
            expect(markingFailures(saved), `${spec.id} textMarking`).toEqual([]);
        }
        const flat = flattenText(font, SYNTHETIC_NAME, marking.capHeightMm, marking.letterSpacingMm, true);

        const cells: Cell[] = [];
        const outDir = process.env.NAME_PLANTAR_VARIANT_STL_DIR;

        for (const spec of specs) {
            const built = await buildSpec(spec, sampleTop, fontBytes);
            for (const side of ["left", "right"] as const) {
                const stl = built[side];
                if (outDir && (spec.id === "0d3db1c0" || spec.id === "ad1e0cc5" || spec.id === "control-442")) {
                    mkdirSync(outDir, { recursive: true });
                    writeFileSync(join(outDir, `${spec.id}_${side}.stl`), Buffer.from(stl.bytes));
                }
                cells.push(gradeCell(spec, side, stl, flat.groups));
            }
        }

        const summary = cells.map((cell) => ({
            id: cell.id,
            side: cell.side,
            g1: cell.g1Pass,
            foot: cell.foot,
            heelHigh: cell.heelHigh,
            heelDeltaMm: Number(cell.heelDeltaMm.toFixed(2)),
            placementU: cell.placementU === null ? null : Number(cell.placementU.toFixed(4)),
            floorMedianZ: Number(cell.floorMedianZ.toFixed(4)),
            soleMinZ: Number(cell.soleMinZ.toFixed(4)),
            soleNearZero: Number(cell.soleNearZero.toFixed(4)),
            g3: cell.g3,
            failures: cell.failures,
            report: cell.report,
            nonTextHash: cell.nonTextHash,
            fullHash: cell.fullHash,
            solidTriangles: cell.solidTriangles,
            uploadTriangles: cell.uploadTriangles,
            stamp: cell.stamp,
            loops: cell.loops.length,
        }));
        writeFileSync("/tmp/name-chirality-gate-report.json", JSON.stringify(summary, null, 2));

        const bad = badChangeGrades(cells, flat.groups);
        writeFileSync("/tmp/name-chirality-bad-change.json", JSON.stringify(bad, null, 2));

        expect(bad.blanketXSign.control442LeftPass, "blanket xSign=-1 on #442").toBe(false);
        expect(bad.blanketXSign.ad1e0cc5LeftPass, "blanket xSign=-1 on ad1e0cc5").toBe(false);
        expect(bad.blanketXSign.path0LeftPass, "blanket xSign=-1 on 0d3db1c0 left").toBe(false);
        expect(bad.yMirror.control442LeftPass, "Y mirror of a correct name").toBe(false);
        expect(bad.oneFoot.leftPass, "one-foot X flip").toBe(false);
        expect(bad.oneFoot.rightPass, "unflipped foot stays readable").toBe(true);
        expect(bad.oneFoot.bothFeetPass, "one-foot flip fails the pair").toBe(false);
        expect(bad.depth.pass, bad.depth.failures.join("; ")).toBe(false);
        expect(bad.placement.pass, bad.placement.failures.join("; ")).toBe(false);
        expect(bad.seam.pass, bad.seam.failures.join("; ")).toBe(false);

        for (const cell of cells) {
            const key = `${cell.id}|${cell.side}`;
            expect(cell.g3, `${key} G3 ${cell.g3.join("; ")}`).toEqual([]);
            expect(cell.stamp, `${key} stamp`).toBe(cell.side);
            expect(cell.foot, `${key} G2`).toBe(cell.side);
            expect(cell.heelHigh, `${key} toe-first`).toBe(true);
            const frozen = FROZEN_NON_TEXT_SHA256[key];
            if (frozen) expect(cell.nonTextHash, `${key} non-text`).toBe(frozen);
            expect(cell.failures, `${key} G1 ${cell.failures.join("; ")}`).toEqual([]);
            expect(cell.g1Pass, key).toBe(true);
            expect(cell.report.sequence, key).toBe(SYNTHETIC_NAME);
        }
    }, 900_000);

    test("write canonical production STLs when NAME_PLANTAR_VARIANT_STL_DIR is set", async () => {
        const outDir = process.env.NAME_PLANTAR_VARIANT_STL_DIR;
        if (!outDir) return;
        const sampleTop = bytesOf(resolve("tests/fixtures/SAMPLE_Top.glb"));
        const fontBytes = bytesOf(resolve("vertex/public/fonts/Inter-Bold.ttf"));
        primeTextFont(fontBytes);
        const sampleFile = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        globalThis.fetch = async (input) => {
            const url = String(input);
            if (!url.includes("SAMPLE_Top")) throw new Error(`unexpected fetch ${url}`);
            return new Response(sampleFile);
        };
        mkdirSync(outDir, { recursive: true });
        for (const spec of [PATH_0D3DB1C0, PATH_AD1E0CC5]) {
            const built = await buildSpec(spec, sampleTop, fontBytes);
            for (const side of ["left", "right"] as const) {
                writeFileSync(join(outDir, `${spec.id}_${side}.stl`), Buffer.from(built[side].bytes));
            }
        }
    }, 300_000);
});

async function buildSpec(
    spec: ProductionPathSpec,
    sampleTop: ArrayBuffer,
    fontBytes: ArrayBuffer,
): Promise<Record<Side, { bytes: ArrayBuffer; solidTriangles: number; uploadTriangles: number }>> {
    if (spec.id === CONTROL_442.id) {
        const design = createDesignWithStockPlaceholder();
        design.method = "printing_solid";
        design.textMarking = { ...defaultBottomTextMarking(), text: SYNTHETIC_NAME, feet: "both", mode: "engrave" };
        useDesignStore.setState({
            design,
            viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
        });
        const out = {} as Record<Side, { bytes: ArrayBuffer; solidTriangles: number; uploadTriangles: number }>;
        for (const side of ["left", "right"] as const) {
            resetManufacturingSolidCache();
            const built = await buildPrinterFootManufacturingStl(side, true);
            out[side] = { bytes: built.stl, solidTriangles: built.solidTriangles, uploadTriangles: built.uploadTriangles };
        }
        return out;
    }
    if (spec.generate === "pair") {
        const settings = loftEnvelope(spec, "left");
        const pair = await buildFinalizedBeltPairFromSavedSettings({
            settingsJson: settings,
            sampleTopBytes: sampleTop,
            fontBytes,
        });
        return {
            left: { bytes: pair.left.stl, solidTriangles: pair.left.solidTriangles, uploadTriangles: pair.left.uploadTriangles },
            right: {
                bytes: pair.right.stl,
                solidTriangles: pair.right.solidTriangles,
                uploadTriangles: pair.right.uploadTriangles,
            },
        };
    }
    const out = {} as Record<Side, { bytes: ArrayBuffer; solidTriangles: number; uploadTriangles: number }>;
    for (const side of ["left", "right"] as const) {
        const settings = loftEnvelope(spec, side);
        const built = await buildFinalizedFootFromSavedDesign({
            design: designStateFromSavedSettings(settings),
            side,
            sampleTopBytes: sampleTop,
            fontBytes,
            includeLeader: true,
        });
        out[side] = { bytes: built.stl, solidTriangles: built.solidTriangles, uploadTriangles: built.uploadTriangles };
    }
    return out;
}

function gradeCell(
    spec: ProductionPathSpec,
    side: Side,
    stl: { bytes: ArrayBuffer; solidTriangles: number; uploadTriangles: number },
    groups: ReturnType<typeof flattenText>["groups"],
): Cell {
    const tris = readStlTriangles(stl.bytes);
    const blobs = extractEngraveBlobs(tris);
    const cloud = handednessGcode(tris);
    const detected = detectGcodeFoot(cloud);
    const samples: Array<{ x: number; y: number; z: number }> = [];
    const foot = footTriangles(tris);
    for (let i = 0; i < foot.length; i += 4) {
        const t = foot[i]!;
        samples.push(meshPointToGcode({
            x: (t.v[0].x + t.v[1].x + t.v[2].x) / 3,
            y: (t.v[0].y + t.v[1].y + t.v[2].y) / 3,
            z: (t.v[0].z + t.v[1].z + t.v[2].z) / 3,
        }));
    }
    const heel = heelEnd(samples);
    const loops = blobs.map((blob) => blob.map((p) => meshPointToReading({ x: p.x, y: p.y, z: 0.3 }, heel.heelHigh !== false)));
    const grade = gradeObservedLoops({
        observed: loops,
        groups,
        letters: SYNTHETIC_NAME,
        printDirection: "toe_first",
        heelHigh: heel.heelHigh,
        heelDeltaMm: heel.deltaMm,
    });
    const sole = soleFacts(tris, blobs);
    const facts = printerFootStlFacts(stl.bytes);
    const cell: Cell = {
        id: spec.id,
        side,
        g1Pass: grade.pass,
        failures: grade.failures,
        report: gradeReport(grade),
        foot: detected.foot,
        heelHigh: heel.heelHigh,
        heelDeltaMm: heel.deltaMm,
        placementU: sole.placementU,
        floorMedianZ: sole.floorMedianZ,
        soleMinZ: sole.minZ,
        soleNearZero: sole.nearZeroFraction,
        nonTextHash: nonTextHash(tris, blobs),
        fullHash: triangleHash(tris),
        solidTriangles: stl.solidTriangles,
        uploadTriangles: stl.uploadTriangles,
        stamp: facts.side,
        loops,
        g3: [],
    };
    cell.g3 = g3Failures(cell);
    return cell;
}

function regrade(
    loops: Array<Array<{ x: number; y: number }>>,
    groups: ReturnType<typeof flattenText>["groups"],
    heelHigh: boolean | null,
): boolean {
    return gradeObservedLoops({
        observed: loops,
        groups,
        letters: SYNTHETIC_NAME,
        printDirection: "toe_first",
        heelHigh,
        heelDeltaMm: 19,
    }).pass;
}

function badChangeGrades(cells: Cell[], groups: ReturnType<typeof flattenText>["groups"]) {
    const find = (id: string, side: Side) => cells.find((cell) => cell.id === id && cell.side === side);
    const control = find(CONTROL_442.id, "left");
    const ad = find(PATH_AD1E0CC5.id, "left");
    const adRight = find(PATH_AD1E0CC5.id, "right");
    const path0 = find(PATH_0D3DB1C0.id, "left");
    const xPass = (cell: Cell | undefined) =>
        cell ? regrade(mirrorLoops(cell.loops, "x"), groups, cell.heelHigh) : true;
    const depth = [
        ...g3Failures({ floorMedianZ: 1.2, soleMinZ: 0.02, soleNearZero: 0.2 }),
        ...markingFailures({ ...defaultBottomTextMarking(), depthMm: 1.2 }),
    ];
    const placement = markingFailures({ ...defaultBottomTextMarking(), placementU: 0.55 });
    const seam = g3Failures({ floorMedianZ: ENGRAVE_DEPTH_MM, soleMinZ: 4, soleNearZero: 0.001 });
    const leftPass = xPass(ad);
    const rightPass = adRight ? regrade(adRight.loops, groups, adRight.heelHigh) : false;
    return {
        blanketXSign: {
            control442LeftPass: xPass(control),
            ad1e0cc5LeftPass: xPass(ad),
            path0LeftPass: xPass(path0),
            rejected: !xPass(control) && !xPass(ad) && !xPass(path0),
        },
        yMirror: {
            control442LeftPass: control ? regrade(mirrorLoops(control.loops, "y"), groups, control.heelHigh) : true,
        },
        oneFoot: {
            leftPass,
            rightPass,
            bothFeetPass: leftPass && rightPass,
        },
        depth: { pass: depth.length === 0, failures: depth },
        placement: { pass: placement.length === 0, failures: placement },
        seam: { pass: seam.length === 0, failures: seam },
    };
}
