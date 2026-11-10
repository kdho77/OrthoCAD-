// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { Euler, Vector3 } from "three";
import { sinkFootprintPose } from "@/components/viewer/element-footprints";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { ElementKind, PlacedElement, PlacedSink, Side } from "@/types";
import { getBaseFootprintFrame } from "./base-modifier";
import { applyElementsToTopMeshLast } from "./element-assets/apply-elements";
import { defaultElementPose, ELEMENT_PROFILES, elementHeightAt } from "./elements";
import { heightFieldYFromMeshY, meshYSign } from "./handedness";
import { sideOffsetX } from "./layout";
import { sampleTopFromArrayBuffer } from "./procedural-wall/sample-top-preview";
import { SINK_KIND_ORDER, SINK_PROFILES } from "./sink";
import { projectViewNdcX } from "./viewport-side-layout";

const SIDES: Side[] = ["left", "right"];

describe("registry anatomical side", () => {
    test("every element lands on its registered border on both feet", () => {
        const kinds = Object.keys(ELEMENT_PROFILES) as ElementKind[];
        expect(kinds.length).toBeGreaterThan(0);
        const length = 260;
        const width = 95;
        for (const kind of kinds) {
            const profile = ELEMENT_PROFILES[kind];
            const left = defaultElementPose(kind, "left", length, width);
            const right = defaultElementPose(kind, "right", length, width);
            expect(right.position.y).toBeCloseTo(-left.position.y, 5);
            if (profile.anatomicalSide === "midline") {
                expect(left.position.y).toBe(0);
                expect(right.position.y).toBe(0);
                continue;
            }
            expect(Math.sign(left.position.y)).toBe(meshYSign("left", profile.anatomicalSide));
            expect(Math.sign(right.position.y)).toBe(meshYSign("right", profile.anatomicalSide));
            for (const side of SIDES) {
                const pose = side === "left" ? left : right;
                const el: PlacedElement = {
                    id: `${kind}-${side}`,
                    kind,
                    side,
                    position: pose.position,
                    rotationDeg: 0,
                    scale: pose.scale,
                    heightMm: pose.heightMm,
                };
                const x = length / 2 + pose.position.x;
                const onBorder = elementHeightAt([el], x, heightFieldYFromMeshY(pose.position.y), length);
                const opposite = elementHeightAt([el], x, pose.position.y, length);
                expect(Math.sign(onBorder)).toBe(profile.sign);
                expect(Math.abs(onBorder)).toBeGreaterThan(0.4);
                if (Math.abs(profile.defaultMedial) * (width / 2) > profile.ryMm) expect(opposite).toBe(0);
            }
        }
        expect(ELEMENT_PROFILES.mortons_extension.defaultHeightMm).toBe(3);
        expect(defaultElementPose("mortons_extension", "left").heightMm).toBe(3);
    });

    test("every sink footprint is medial or lateral on both feet, not a copied world Y", () => {
        expect(SINK_KIND_ORDER.length).toBe(Object.keys(SINK_PROFILES).length);
        const length = 260;
        const width = 95;
        for (const kind of SINK_KIND_ORDER) {
            const anatomical = SINK_PROFILES[kind].anatomicalSide;
            expect(anatomical === "midline").toBe(false);
            const sink = (side: Side): PlacedSink => ({ id: `${kind}-${side}`, kind, depthMm: 2 });
            const left = sinkFootprintPose(sink("left"), "left", length, width);
            const right = sinkFootprintPose(sink("right"), "right", length, width);
            if (!left || !right) throw new Error(`${kind} footprint missing`);
            expect(left.outline.length).toBeGreaterThan(8);
            expect(right.outline.length).toBeGreaterThan(8);
            expect(Math.sign(left.y)).toBe(meshYSign("left", anatomical));
            expect(Math.sign(right.y)).toBe(meshYSign("right", anatomical));
            expect(right.y).toBeCloseTo(-left.y, 3);
        }
    });

    test("Top view puts medial borders toward the other foot and lateral borders away", () => {
        const length = 260;
        const width = 95;
        const ndc = (side: Side, meshX: number, meshY: number) => {
            const world = new Vector3(meshX, sideOffsetX(side, width) + meshY, 4).applyEuler(
                new Euler(-Math.PI / 2, 0, 0),
            );
            return projectViewNdcX("top", world);
        };
        const facesPartner = (side: Side, meshX: number, meshY: number) =>
            Math.abs(ndc(side, meshX, meshY)) < Math.abs(ndc(side, meshX, 0));
        for (const kind of Object.keys(ELEMENT_PROFILES) as ElementKind[]) {
            const anatomical = ELEMENT_PROFILES[kind].anatomicalSide;
            if (anatomical === "midline") continue;
            for (const side of SIDES) {
                const pose = defaultElementPose(kind, side, length, width);
                expect(facesPartner(side, pose.position.x, pose.position.y)).toBe(anatomical === "medial");
            }
        }
        for (const kind of SINK_KIND_ORDER) {
            const anatomical = SINK_PROFILES[kind].anatomicalSide;
            for (const side of SIDES) {
                const pose = sinkFootprintPose({ id: kind, kind, depthMm: 2 }, side, length, width);
                if (!pose) throw new Error(`${kind} missing`);
                expect(facesPartner(side, pose.x - length / 2, pose.y)).toBe(anatomical === "medial");
            }
        }
    });

    test("Morton's raise is on the medial half of both SAMPLE_Top feet, inboard of the rim", async () => {
        const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const raw = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        const corrections = {
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
        try {
            for (const side of SIDES) {
                const base = side === "right" ? mirrorGeometry(raw) : raw.clone();
                const frame = getBaseFootprintFrame(base, side);
                const pose = defaultElementPose("mortons_extension", side, frame.lenSize, frame.widSize);
                expect(pose.heightMm).toBe(3);
                const composed = base.clone();
                await applyElementsToTopMeshLast(
                    composed,
                    base,
                    {
                        side,
                        lengthMm: frame.lenSize,
                        widthMm: frame.widSize,
                        thicknessMm: 3,
                        elements: [{ id: "m", kind: "mortons_extension", side, ...pose }],
                        corrections,
                    },
                    { subdivide: false },
                );
                const before = base.getAttribute("position");
                const after = composed.getAttribute("position");
                let sumY = 0;
                let weight = 0;
                let edge = 0;
                for (let i = 0; i < after.count; i++) {
                    const u = (before.getComponent(i, frame.lengthAxis) - frame.lenMin) / frame.lenSize;
                    const y = before.getComponent(i, frame.widthAxis) - frame.widCenter;
                    if (u > 0.7) edge = Math.max(edge, Math.abs(y));
                    const lift =
                        after.getComponent(i, frame.thickAxis) - before.getComponent(i, frame.thickAxis);
                    if (lift < 0.5) continue;
                    sumY += y * lift;
                    weight += lift;
                }
                const centroidY = sumY / weight;
                const center = new Vector3(0, sideOffsetX(side, frame.widSize), 4).applyEuler(
                    new Euler(-Math.PI / 2, 0, 0),
                );
                const pad = new Vector3(0, sideOffsetX(side, frame.widSize) + centroidY, 4).applyEuler(
                    new Euler(-Math.PI / 2, 0, 0),
                );
                expect(Math.abs(projectViewNdcX("top", pad))).toBeLessThan(
                    Math.abs(projectViewNdcX("top", center)),
                );
                expect(Math.abs(centroidY)).toBeLessThan(edge * 0.8);
                expect(Math.sign(centroidY)).toBe(meshYSign(side, "medial"));
                composed.dispose();
                base.dispose();
            }
        } finally {
            raw.dispose();
        }
    }, 120_000);
});
