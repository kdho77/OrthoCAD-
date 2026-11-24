// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Frozen gates. The test passes when the gates behave:
// identity on BASE fails G1 and passes G2–G4; a wrong transform fails its gate;
// an X flip about the block centre on both feet passes every gate.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { beltPrintFrameDet, gantryFromAboveView, physicalPlantarView, toeTowardViewerView } from "./camera";
import {
    assertBaseCap,
    emptyDesignMarking,
    type FootPlacement,
    gradeAll,
    gradePlacement,
    identityGcode,
    identityGeometryReport,
    meshOfGcodeLine,
    noTextGeometryBytes,
    noTextIsInactive,
    placeBeltName,
    productionMarking,
    skewInsetOnDisk,
} from "./grade";
import { soleGeometry } from "./host";
import {
    fitLinear,
    gradeOutsideGcode,
    jHookExtendsLeft,
    leadingGlyphIndex,
    placementPivot,
    textRegion,
} from "./measure";
import { SKEW_INSET_RATIO_BASE } from "./thresholds";

const PROOFS = resolve(process.cwd(), "validation/name_mirror_fix_gates/proofs");

function writeProof(name: string, body: unknown) {
    writeFileSync(resolve(PROOFS, name), `${JSON.stringify(body, null, 4)}\n`);
}

function pivotOf(foot: FootPlacement): { x: number; y: number } {
    return placementPivot(foot.flat.centroids, foot.placed.meta.centroids, {
        x: foot.flat.advanceMm / 2,
        y: foot.flat.capHeightMm / 2,
    });
}

function mapFoot(
    foot: FootPlacement,
    fn: (p: { x: number; y: number }) => { x: number; y: number },
): FootPlacement {
    const mapLoop = (loop: Array<{ x: number; y: number }>) => loop.map(fn);
    return {
        ...foot,
        placed: {
            ...foot.placed,
            flat: {
                ...foot.placed.flat,
                groups: foot.placed.flat.groups.map((group) => ({
                    outer: mapLoop(group.outer),
                    holes: group.holes.map(mapLoop),
                })),
                centroids: foot.placed.flat.centroids.map(fn),
            },
            meta: {
                ...foot.placed.meta,
                centroids: foot.placed.meta.centroids.map((c) => ({ ...fn(c), z: c.z })),
            },
        },
    };
}

function flipXAboutPivot(foot: FootPlacement): FootPlacement {
    const c = pivotOf(foot);
    return mapFoot(foot, (p) => ({ x: 2 * c.x - p.x, y: p.y }));
}

function flipYAboutPivot(foot: FootPlacement): FootPlacement {
    const c = pivotOf(foot);
    return mapFoot(foot, (p) => ({ x: p.x, y: 2 * c.y - p.y }));
}

function shiftX(foot: FootPlacement, dx: number): FootPlacement {
    return mapFoot(foot, (p) => ({ x: p.x + dx, y: p.y }));
}

function withDepth(foot: FootPlacement, depthMm: number): FootPlacement {
    return {
        ...foot,
        marking: { ...foot.marking, depthMm },
        placed: {
            ...foot.placed,
            meta: {
                ...foot.placed.meta,
                centroids: foot.placed.meta.centroids.map((c) => ({ ...c, z: depthMm })),
            },
        },
    };
}

async function bothFeet() {
    const left = await placeBeltName("left");
    const right = await placeBeltName("right");
    return [left, right] as [FootPlacement, FootPlacement];
}

function geometryOf(
    hostSide: "left" | "right",
    glyphs: Array<{ x: number; y: number }>,
    mutateHeel: boolean,
) {
    const base = soleGeometry(hostSide);
    const candidate = soleGeometry(hostSide);
    if (mutateHeel) {
        const pos = candidate.getAttribute("position");
        pos.setX(0, pos.getX(0) + 0.25);
    }
    const report = identityGeometryReport(base, candidate, glyphs);
    const bottomZ = Math.max(
        Math.abs(base.getAttribute("position").getZ(0)),
        Math.abs(base.getAttribute("position").getZ(1)),
        Math.abs(base.getAttribute("position").getZ(2)),
        Math.abs(base.getAttribute("position").getZ(3)),
    );
    base.dispose();
    candidate.dispose();
    return { report, bottomZ };
}

describe("plantar-face name chirality gates", () => {
    test("physical camera is the X flip of the gantry view and looks through the belt", () => {
        expect(beltPrintFrameDet()).toBeCloseTo(-1, 6);
        const origin = { x: 0, y: 0, z: 0 };
        const toe = { x: 1, y: 0, z: 0 };
        const across = { x: 0, y: 1, z: 0 };
        const gantryToe = gantryFromAboveView(toe);
        const gantryOrigin = gantryFromAboveView(origin);
        const gantryAcross = gantryFromAboveView(across);
        expect(gantryToe.x - gantryOrigin.x).toBeCloseTo(1, 6);
        expect(gantryAcross.y - gantryOrigin.y).toBeCloseTo(1, 6);
        const physicalToe = physicalPlantarView(toe);
        const physicalOrigin = physicalPlantarView(origin);
        const physicalAcross = physicalPlantarView(across);
        expect(physicalToe.x - physicalOrigin.x).toBeCloseTo(-1, 6);
        expect(physicalAcross.y - physicalOrigin.y).toBeCloseTo(1, 6);
        const toward = toeTowardViewerView(toe);
        const towardOrigin = toeTowardViewerView(origin);
        expect(toward.y - towardOrigin.y).toBeCloseTo(-1, 6);
        const face = physicalPlantarView({ x: 3, y: 4, z: 0 });
        const spun = toeTowardViewerView({ x: 3, y: 4, z: 0 });
        expect(spun.x).toBeCloseTo(-face.y, 6);
        expect(spun.y).toBeCloseTo(face.x, 6);
    });

    test("identity placement fails G1 and passes G2–G4", async () => {
        assertBaseCap();
        expect(skewInsetOnDisk()).toBe(SKEW_INSET_RATIO_BASE);
        const feet = await bothFeet();
        const empty = emptyDesignMarking();
        expect(noTextIsInactive(empty)).toBe(true);
        expect(noTextIsInactive({ ...productionMarking(), text: "", addPatientName: true })).toBe(true);
        const noText = await noTextGeometryBytes(empty);
        expect(noText.sameRef).toBe(true);

        const glyphs = feet.flatMap((foot) => foot.placed.flat.groups.flatMap((group) => group.outer));
        const geo = geometryOf("left", glyphs, false);
        const lines = identityGcode(feet);
        const gcode = gradeOutsideGcode(lines, lines, meshOfGcodeLine, textRegion(glyphs));
        const results = gradeAll({
            feet,
            geometry: geo.report,
            gcode,
            files: [],
            diffText: "",
            soleBottomMaxAbsZmm: geo.bottomZ,
            noText: { sameBytes: noText.sameRef, baseHash: noText.hash, candidateHash: noText.hash },
        });
        const byId = Object.fromEntries(results.map((row) => [row.id, row]));
        writeProof("noop.json", {
            base: "8aced4b5042bdafc2d300006fa80802bca1b94b9",
            name: "JABBOUR",
            center: pivotOf(feet[0]!),
            mappedWidthMm: feet[0]!.placed.meta.mappedWidthMm,
            gates: byId,
        });
        expect(byId.G1?.pass, byId.G1?.failures.join("; ")).toBe(false);
        expect(byId.G2?.pass, byId.G2?.failures.join("; ")).toBe(true);
        expect(byId.G3?.pass, byId.G3?.failures.join("; ")).toBe(true);
        expect(byId.G4?.pass, byId.G4?.failures.join("; ")).toBe(true);
        expect(Number(byId.G1?.measured.leftAdvanceMm)).toBeLessThan(0);
        expect(Number(byId.G1?.measured.rightAdvanceMm)).toBeLessThan(0);
        const jay = leadingGlyphIndex(feet[0]!.flat.centroids);
        const gantry = fitLinear(
            feet[0]!.flat.groups[jay]!.outer,
            feet[0]!.placed.flat.groups[jay]!.outer.map((p) => gantryFromAboveView({ x: p.x, y: p.y, z: 0 })),
        );
        expect(gantry.a).toBeGreaterThan(0.5);
        expect(gantry.d).toBeGreaterThan(0.5);
        expect(
            jHookExtendsLeft(feet[0]!.placed.flat.groups[jay]!.outer, (p) =>
                gantryFromAboveView({ x: p.x, y: p.y, z: 0 }),
            ),
        ).toBe(true);
    }, 120_000);

    test("a centered X flip on both feet passes, and each wrong transform fails its gate", async () => {
        const [left, right] = await bothFeet();
        const good = [flipXAboutPivot(left), flipXAboutPivot(right)] as [FootPlacement, FootPlacement];
        const goodGrade = gradePlacement(good);
        expect(goodGrade.g1.pass, goodGrade.g1.failures.join("; ")).toBe(true);
        expect(goodGrade.g2.pass, goodGrade.g2.failures.join("; ")).toBe(true);

        const yOnly = gradePlacement([flipYAboutPivot(good[0]!), flipYAboutPivot(good[1]!)]);
        expect(yOnly.g1.pass).toBe(false);
        expect(yOnly.g2.pass, yOnly.g2.failures.join("; ")).toBe(true);

        const oneFoot = gradePlacement([flipXAboutPivot(left), right]);
        expect(oneFoot.g1.pass).toBe(false);
        expect(oneFoot.g1.failures.some((line) => line.startsWith("right"))).toBe(true);

        const deep = gradePlacement([withDepth(good[0]!, 1.2), withDepth(good[1]!, 1.2)]);
        expect(deep.g1.pass, deep.g1.failures.join("; ")).toBe(true);
        expect(deep.g2.pass).toBe(false);
        expect(deep.g2.failures.some((line) => line.includes("depth"))).toBe(true);

        const moved = gradePlacement([shiftX(good[0]!, 5), shiftX(good[1]!, 5)]);
        expect(moved.g2.pass).toBe(false);
        expect(moved.g2.failures.some((line) => line.includes("pivot x"))).toBe(true);

        const glyphs = good.flatMap((foot) => foot.placed.flat.groups.flatMap((group) => group.outer));
        const movedGeo = geometryOf("left", glyphs, true);
        expect(movedGeo.report.pass).toBe(false);
        expect(movedGeo.report.differing).toBe(1);

        const lines = identityGcode(good);
        const heel = lines[0]!.replace("G1 X", "G1 X1");
        const gcodeBad = gradeOutsideGcode(
            lines,
            [heel, ...lines.slice(1)],
            meshOfGcodeLine,
            textRegion(glyphs),
        );
        expect(gcodeBad.pass).toBe(false);
        const textLine = lines.find((line) => line.includes("glyph"));
        expect(textLine).toBeDefined();
        const changedText = lines.map((line) => (line === textLine ? line.replace("G1 X", "G1 X9") : line));
        const gcodeText = gradeOutsideGcode(lines, changedText, meshOfGcodeLine, textRegion(glyphs));
        expect(gcodeText.pass).toBe(true);

        const scope = gradeAll({
            feet: good,
            geometry: geometryOf("left", glyphs, false).report,
            gcode: { pass: true, outsideBase: 2, outsideCandidate: 2 },
            files: ["vertex/src/lib/kiri/slicer.ts"],
            diffText: "",
            soleBottomMaxAbsZmm: 0,
            noText: { sameBytes: true, baseHash: "aa", candidateHash: "aa" },
        });
        expect(scope.find((row) => row.id === "G3")?.pass).toBe(false);

        const cap = gradeAll({
            feet: good,
            geometry: geometryOf("left", glyphs, false).report,
            gcode: { pass: true, outsideBase: 2, outsideCandidate: 2 },
            files: [],
            diffText: "-export const SKEW_INSET_RATIO = 0.5;\n+export const SKEW_INSET_RATIO = 0.8;\n",
            soleBottomMaxAbsZmm: 0,
            noText: { sameBytes: true, baseHash: "aa", candidateHash: "aa" },
        });
        expect(cap.find((row) => row.id === "G3")?.pass).toBe(false);
        expect(cap.find((row) => row.id === "G3")?.failures.join(" ")).toContain("SKEW_INSET_RATIO");

        const raised = gradeAll({
            feet: good,
            geometry: { pass: true, differing: 0, maxMm: 0 },
            gcode: { pass: true, outsideBase: 1, outsideCandidate: 1 },
            files: [],
            diffText: "",
            soleBottomMaxAbsZmm: 0.4,
            noText: { sameBytes: true, baseHash: "aa", candidateHash: "aa" },
        });
        expect(raised.find((row) => row.id === "G3")?.pass).toBe(false);

        const bytes = gradeAll({
            feet: good,
            geometry: { pass: true, differing: 0, maxMm: 0 },
            gcode: { pass: true, outsideBase: 1, outsideCandidate: 1 },
            files: [],
            diffText: "",
            soleBottomMaxAbsZmm: 0,
            noText: { sameBytes: false, baseHash: "abc", candidateHash: "def" },
        });
        expect(bytes.find((row) => row.id === "G4")?.pass).toBe(false);

        const passing = gradeAll({
            feet: good,
            geometry: geometryOf("left", glyphs, false).report,
            gcode: gcodeText,
            files: ["vertex/src/lib/geometry/text-marking/place.ts"],
            diffText: "",
            soleBottomMaxAbsZmm: 0,
            noText: { sameBytes: true, baseHash: "aa", candidateHash: "aa" },
        });
        expect(passing.every((row) => row.pass)).toBe(true);

        writeProof("bad-change.json", {
            yFlipG1: yOnly.g1.pass,
            oneFootG1: oneFoot.g1.pass,
            oneFootFailures: oneFoot.g1.failures,
            depthG2: deep.g2.pass,
            depthFailures: deep.g2.failures,
            shiftG2: moved.g2.pass,
            outsideVertices: movedGeo.report.differing,
            gcodeOutsidePass: gcodeBad.pass,
            gcodeInsideStillPasses: gcodeText.pass,
            slicerScopePass: scope.find((row) => row.id === "G3")?.pass,
            capPass: cap.find((row) => row.id === "G3")?.pass,
            raisedSolePass: raised.find((row) => row.id === "G3")?.pass,
            noTextPass: bytes.find((row) => row.id === "G4")?.pass,
            goodXFlip: Object.fromEntries(passing.map((row) => [row.id, row.pass])),
            goodMeasured: Object.fromEntries(passing.map((row) => [row.id, row.measured])),
        });
    }, 120_000);
});
