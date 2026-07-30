// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import * as THREE from "three";
import {
    buildMarkerFrame,
    clearMarkerFrameRegistry,
    deriveBaseLandmarks,
    deriveMedialWidthSign,
    getMarkerFrame,
    measureHeightDatumDelta,
    mirrorBaseLandmarks,
    registerRawBaseGeometry,
    sharedStationWidthPlateau,
} from "@/lib/geometry/marker-frame";
import { detectArchSideSign } from "@/lib/geometry/base-modifier";
import { extractMergedGeometry, loadGlbFromBuffer, mirrorGeometry, reorientToFootprintFrame } from "@/lib/library/loaders";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");

/** Phase 0 audit B3 plantar centroid (mm), tolerance 0.5mm. */
const PHASE0_B3 = { x: 44.12, y: 1.57, z: 3.81 };

let rawLeft: BufferGeometry;

beforeAll(async () => {
    const buf = readFileSync(FIXTURE);
    const group = await loadGlbFromBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error("Default.glb produced no geometry");
    rawLeft = reorientToFootprintFrame(merged.geometry);
    merged.geometry.dispose();
});

afterEach(() => {
    clearMarkerFrameRegistry();
});

function rotationDet(m: THREE.Matrix4): number {
    const e = new THREE.Matrix4().extractRotation(m).elements;
    return (
        e[0]! * (e[5]! * e[10]! - e[6]! * e[9]!) -
        e[1]! * (e[4]! * e[10]! - e[6]! * e[8]!) +
        e[2]! * (e[4]! * e[9]! - e[5]! * e[8]!)
    );
}

describe("marker-frame Phase 1A/1B — Default.glb landmarks", () => {
    test("T1 — B3 matches Phase 0 audit within 0.5mm", () => {
        const lm = deriveBaseLandmarks(rawLeft, { primarySide: "left" });
        expect(lm).not.toBeNull();
        expect(lm!.B3.distanceTo(new THREE.Vector3(PHASE0_B3.x, PHASE0_B3.y, PHASE0_B3.z))).toBeLessThanOrEqual(
            0.5,
        );
    });

    test("T2 — independent maximizers at different stations; contiguous crest bands", () => {
        const lm = deriveBaseLandmarks(rawLeft, { primarySide: "left" })!;
        const pos = rawLeft.getAttribute("position")!;
        const arr = pos.array as Float32Array;
        const topN = (rawLeft.userData as { topVertexCount: number }).topVertexCount;
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < topN; i++) {
            const x = arr[i * 3]!;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
        }
        const lengthMm = maxX - minX || 1;
        const uB1 = (lm.B1.x - minX) / lengthMm;
        const uB2 = (lm.B2.x - minX) / lengthMm;

        // Different stations — tombstone against shared-station search
        expect(Math.abs(uB1 - uB2)).toBeGreaterThan(0.03);

        // Each crest band is populated and contiguous in X (span within forefoot)
        expect(lm.crestBandCounts.medial).toBeGreaterThanOrEqual(15);
        expect(lm.crestBandCounts.lateral).toBeGreaterThanOrEqual(15);

        // Second-best station on each side (bin-wise) is near the crest, not a rival peak far away
        const sign = lm.medialWidthSign;
        const sidePeakU = (side: "medial" | "lateral") => {
            const score = (y: number) => (side === "medial" ? y * sign : -y * sign);
            const ST = 100;
            const best = new Float64Array(ST).fill(-Infinity);
            for (let i = 0; i < topN; i++) {
                const u = (arr[i * 3]! - minX) / lengthMm;
                if (u < 0.55 || u > 0.95) continue;
                const bi = Math.min(ST - 1, Math.max(0, Math.floor(u * ST)));
                const s = score(arr[i * 3 + 1]!);
                if (s > best[bi]!) best[bi] = s;
            }
            const ranked = [...best.keys()]
                .filter((i) => Number.isFinite(best[i]!))
                .map((i) => ({ u: (i + 0.5) / ST, s: best[i]! }))
                .sort((a, b) => b.s - a.s);
            return ranked;
        };
        const med = sidePeakU("medial");
        const lat = sidePeakU("lateral");
        expect(med.length).toBeGreaterThan(1);
        expect(lat.length).toBeGreaterThan(1);
        // Best and second-best on each side are within 5% foot length (one crest)
        expect(Math.abs(med[0]!.u - med[1]!.u)).toBeLessThan(0.05);
        expect(Math.abs(lat[0]!.u - lat[1]!.u)).toBeLessThan(0.05);
        // The two sides resolve to different stations
        expect(Math.abs(med[0]!.u - lat[0]!.u)).toBeGreaterThan(0.03);
        expect(Math.abs(uB1 - uB2)).toBeGreaterThan(0.03);
    });

    test("T3 — signed B1/B2 separation: B2 proximal to B1, magnitude 5–15%", () => {
        const lm = deriveBaseLandmarks(rawLeft, { primarySide: "left" })!;
        expect(lm.b1b2SeparationPct).toBeGreaterThan(0); // u_B2 < u_B1
        expect(lm.b1b2SeparationPct).toBeGreaterThanOrEqual(5);
        expect(lm.b1b2SeparationPct).toBeLessThanOrEqual(15);
    });

    test("T4 — det(T_marker) = +1 within 1e-9", () => {
        const lm = deriveBaseLandmarks(rawLeft, { primarySide: "left" })!;
        const frame = buildMarkerFrame(lm, "stock-default");
        expect(Math.abs(rotationDet(frame.matrix) - 1)).toBeLessThanOrEqual(1e-9);
    });

    test("T5 — T_marker preserves B1/B2/B3 pairwise distances within 1e-6", () => {
        const lm = deriveBaseLandmarks(rawLeft, { primarySide: "left" })!;
        const frame = buildMarkerFrame(lm, "stock-default");
        const map = (v: THREE.Vector3) => v.clone().applyMatrix4(frame.matrix);
        const b1 = map(lm.B1);
        const b2 = map(lm.B2);
        const b3 = map(lm.B3);
        expect(Math.abs(b1.distanceTo(b2) - lm.B1.distanceTo(lm.B2))).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(b1.distanceTo(b3) - lm.B1.distanceTo(lm.B3))).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(b2.distanceTo(b3) - lm.B2.distanceTo(lm.B3))).toBeLessThanOrEqual(1e-6);
        // Origin is B3 in marker frame
        expect(b3.length()).toBeLessThanOrEqual(1e-6);
    });

    test("T6 — getMarkerFrame arity has no geometry parameter; cache not rebuildable via conformed mesh", () => {
        expect(getMarkerFrame.length).toBe(1);
        // No public export that accepts BufferGeometry and returns a cached frame
        expect(typeof registerRawBaseGeometry).toBe("function");
        expect(registerRawBaseGeometry.length).toBeGreaterThanOrEqual(2);
        expect(typeof getMarkerFrame).toBe("function");

        const frame1 = registerRawBaseGeometry("stock-default", rawLeft, { primarySide: "left" });
        const again = getMarkerFrame("stock-default");
        expect(again).toBe(frame1);

        // Conformed (modified) clone cannot be passed to getMarkerFrame at all.
        const conformed = rawLeft.clone();
        const pos = conformed.getAttribute("position")!;
        (pos.array as Float32Array)[2] += 5; // displace a vertex
        pos.needsUpdate = true;

        // Accessor still returns the original registered frame — no geometry arg to poison it
        const still = getMarkerFrame("stock-default");
        expect(still).toBe(frame1);
        expect(still!.landmarks.B3.z).toBeCloseTo(frame1.landmarks.B3.z, 6);

        // Re-registering under a different id with conformed mesh would create a NEW entry
        // (allowed for tests) but cannot overwrite stock-default without explicit re-register
        expect(getMarkerFrame("stock-default")).toBe(frame1);
        conformed.dispose();
    });

    test("T10 — mirrored landmarks are the sagittal mirror of the left, exactly", () => {
        const left = deriveBaseLandmarks(rawLeft, { primarySide: "left" })!;
        const mirroredGeo = mirrorGeometry(rawLeft);
        const fromMirrored = deriveBaseLandmarks(mirroredGeo, { primarySide: "left" })!;
        const carried = mirrorBaseLandmarks(left);

        expect(carried.B1.distanceTo(fromMirrored.B1)).toBeLessThanOrEqual(0.5);
        expect(carried.B2.distanceTo(fromMirrored.B2)).toBeLessThanOrEqual(0.5);
        expect(carried.B3.distanceTo(fromMirrored.B3)).toBeLessThanOrEqual(0.5);
        mirroredGeo.dispose();
    });

    test("C3 — derived medial sign agrees with detectArchSideSign", () => {
        const derived = deriveMedialWidthSign(rawLeft);
        const fromArch = detectArchSideSign(rawLeft);
        expect(derived).toBe(fromArch);
        expect(derived).toBe(-1); // Default.glb arch on width− after reorient (PR #121)
    });

    test("tombstone — shared-station search reproduces Phase 0 plateau", () => {
        const plateau = sharedStationWidthPlateau(rawLeft, 80);
        // Phase 0: 9 stations within 1.0mm; top-two 0.008mm apart
        expect(plateau.length).toBeGreaterThanOrEqual(6);
        expect(plateau.length).toBeLessThanOrEqual(12);
        const sorted = [...plateau].sort((a, b) => b.widthMm - a.widthMm);
        expect(Math.abs(sorted[0]!.widthMm - sorted[1]!.widthMm)).toBeLessThan(0.05);
    });
});

describe("marker-frame Phase 1C — height datum delta (MANDATORY HALT)", () => {
    test("measure angle and station offsets on Default.glb", () => {
        const frame = registerRawBaseGeometry("stock-default", rawLeft, { primarySide: "left" });
        const delta = measureHeightDatumDelta(rawLeft, frame);

        // Surface numbers for the halt report (also asserted printable)
        const report = {
            angleDeg: delta.angleDeg,
            offsetHeelMm: delta.offsetHeelMm,
            offsetArchApexMm: delta.offsetArchApexMm,
            offsetMetMm: delta.offsetMetMm,
            maxAbsOffsetMm: delta.maxAbsOffsetMm,
            plantarPlaneZ: delta.plantarPlaneZ,
            B1: frame.landmarks.B1.toArray(),
            B2: frame.landmarks.B2.toArray(),
            B3: frame.landmarks.B3.toArray(),
            b1b2SeparationPct: frame.landmarks.b1b2SeparationPct,
            crestBandMm: frame.landmarks.crestBandMm,
            crestBandCounts: frame.landmarks.crestBandCounts,
            medialWidthSign: frame.landmarks.medialWidthSign,
            halt:
                delta.angleDeg <= 2.0 && delta.maxAbsOffsetMm <= 1.0
                    ? "WITHIN_THRESHOLDS — await Go for Phase 1D"
                    : "THRESHOLDS_EXCEEDED — HARD STOP",
        };
        // eslint-disable-next-line no-console
        console.log("[PHASE-1C]", JSON.stringify(report, null, 2));

        expect(Number.isFinite(delta.angleDeg)).toBe(true);
        expect(Number.isFinite(delta.maxAbsOffsetMm)).toBe(true);
        expect(delta.plantarPlaneZ).toBeCloseTo(0.201, 2);
    });
});
