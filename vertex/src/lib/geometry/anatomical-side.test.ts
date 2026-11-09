// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { sinkFootprintPose } from "@/components/viewer/element-footprints";
import type { ElementKind, PlacedElement, PlacedSink, Side } from "@/types";
import { defaultElementPose, ELEMENT_PROFILES, elementHeightAt } from "./elements";
import { heightFieldYFromMeshY, meshYSign } from "./handedness";
import { SINK_KIND_ORDER, SINK_PROFILES } from "./sink";

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
});
