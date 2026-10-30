// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    hashLiveBottomPattern,
    livePatternMarksSolidStale,
    resolveLiveBottomPattern,
} from "./live-bottom-pattern";
import { hashPatternPoints, proceduralLoftReuseKey } from "./preview-loft-ui";

describe("live bottom pattern at Print generate", () => {
    test("Print reads the live stored curve, not a load/Base snapshot key", () => {
        const stored = {
            points: [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(80, 12, 0),
                new THREE.Vector3(160, 0, 0),
                new THREE.Vector3(80, -10, 0),
            ],
        };
        const live = resolveLiveBottomPattern({ draft: null, stored });
        expect(live).toHaveLength(4);
        expect(live?.[1]?.y).toBe(12);
        const snapshotKey = "sample-top:p:full_contact:hw0.00:wmedium";
        expect(hashLiveBottomPattern(live)).not.toBe(snapshotKey);
    });

    test("manual Edit-bottom-pattern draft wins over the stored curve", () => {
        const stored = {
            points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 8, 0)],
        };
        const draft = {
            points: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(10, 2, 0), new THREE.Vector3(10, 9, 0)],
        };
        const live = resolveLiveBottomPattern({ draft, stored });
        expect(live?.[0]?.y).toBe(1);
        expect(live?.[1]?.y).toBe(2);
    });

    test("editing the pattern after a solid was built marks the solid stale", () => {
        const built = [
            { x: 0, y: 0, z: 0 },
            { x: 40, y: 8, z: 0 },
            { x: 80, y: 0, z: 0 },
        ];
        const builtHash = hashPatternPoints(built);
        const edited = built.map((p, i) => (i === 1 ? { ...p, y: p.y + 3.5 } : p));
        expect(livePatternMarksSolidStale(builtHash, edited)).toBe(true);
        expect(livePatternMarksSolidStale(builtHash, built)).toBe(false);
        const keyA = proceduralLoftReuseKey({
            side: "left",
            wallStyle: "straight",
            deviceType: "functional",
            thicknessMm: 3,
            correctionsJson: "{}",
            scanPattern: "full_contact",
            patternKind: "live",
            patternHash: hashLiveBottomPattern(built),
            flanges: "0:40:10",
        });
        const keyB = proceduralLoftReuseKey({
            side: "left",
            wallStyle: "straight",
            deviceType: "functional",
            thicknessMm: 3,
            correctionsJson: "{}",
            scanPattern: "full_contact",
            patternKind: "live",
            patternHash: hashLiveBottomPattern(edited),
            flanges: "0:40:10",
        });
        expect(keyA).not.toBe(keyB);
    });
});
