// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { interpretOneClickRx, UNSPECIFIED_MEDIAL_SKIVE_MM } from "@/lib/clinical/one-click-rx";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { ELEMENT_PROFILES } from "@/lib/geometry/elements";
import { sinksForSide } from "@/lib/geometry/migrate-corrections";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { SINK_PROFILES } from "@/lib/geometry/sink";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState, ElementKind, Side, SideCorrections, SinkKind } from "@/types";
import { archHeightScan } from "../../../../tests/helpers/arch-height-scan";
import { loadSampleTopGlb } from "../../../../tests/helpers/load-sample-top-glb";

const shoe = { system: "us" as const, value: 9 };

function scan(heightMm: number, side: Side) {
    const geometry = archHeightScan(heightMm, side);
    return { side, geometry, display: buildScanDisplayInfo(geometry), keepSetApproved: true };
}

function baseline(): DesignState {
    return createDesignWithStockPlaceholder(defaultDesign());
}

function positionBytes(geometry: BufferGeometry): Buffer {
    const attr = geometry.getAttribute("position");
    const arr = attr.array as Float32Array;
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function meshFor(base: BufferGeometry, design: DesignState, side: Side): BufferGeometry {
    const paired = design.paired;
    const thickness = paired
        ? side === "left"
            ? paired.leftThicknessMm
            : paired.rightThicknessMm
        : design.thicknessMm;
    return applyBaseModifiers(base, baseModifierFieldAuthoritative(design, side, thickness), 0);
}

type HandSpec = {
    corrections?: Partial<Record<Side, Partial<SideCorrections>>>;
    elements?: { kind: ElementKind; side: Side }[];
    sinks?: { kind: SinkKind; side: Side; depthMm?: number }[];
};

/** The Corrections / Elements / Sinks controls, in the order a user would set them. */
function designByHand(source: DesignState, spec: HandSpec): DesignState {
    useDesignStore.setState({
        design: JSON.parse(JSON.stringify(source)) as DesignState,
        pendingSessionDesign: null,
        selectedElementId: null,
        history: [],
        future: [],
    });
    const api = useDesignStore.getState();
    api.setLinked(false);
    api.setUsShoeSize(shoe.value);
    for (const side of ["left", "right"] as const) {
        const patch = spec.corrections?.[side];
        if (patch) api.updateCorrection(side, patch);
    }
    for (const element of spec.elements ?? []) api.addElement(element.kind, element.side);
    for (const sink of spec.sinks ?? []) {
        api.addSink(sink.kind, sink.side);
        if (sink.depthMm === undefined) continue;
        const placed = sinksForSide(useDesignStore.getState().design, sink.side)?.find(
            (item) => item.kind === sink.kind,
        );
        if (placed && placed.depthMm !== sink.depthMm) {
            useDesignStore.getState().updateSink(placed.id, { depthMm: sink.depthMm }, sink.side);
        }
    }
    return useDesignStore.getState().design;
}

function expectSameMesh(base: BufferGeometry, oneClick: DesignState, hand: DesignState, side: Side): void {
    const a = meshFor(base, oneClick, side);
    const b = meshFor(base, hand, side);
    try {
        expect(positionBytes(a).equals(positionBytes(b))).toBe(true);
    } finally {
        a.dispose();
        b.dispose();
    }
}

describe("one-click writes the existing controls", () => {
    test("Low, Standard, and High sliders, with and without Flexible", () => {
        const rows: [number, number, boolean, number][] = [
            [20, -3.5, false, 0],
            [20, -3.5, true, 4],
            [24, 0, false, 0],
            [24, 0, true, 4],
            [28, 3, false, 0],
            [28, 3, true, 4],
        ];
        for (const [measured, arch, flexible, apex] of rows) {
            const foot = scan(measured, "left");
            const out = generateOrthoticFromScanAndRx({
                baselineDesign: baseline(),
                scans: [foot],
                shoeSize: shoe,
                flexibleBySide: { left: flexible },
            });
            if (!out.ok) throw new Error(`${measured}/${flexible}: ${out.reason}`);
            expect(out.design.corrections.left.archHeightMm, `${measured} flex ${flexible}`).toBe(arch);
            expect(out.design.corrections.left.apexMoveMm, `${measured} flex ${flexible}`).toBe(apex);
            expect(out.design.corrections.linked).toBe(false);
            foot.geometry.dispose();
        }
    });

    test("a later slider move replaces the generated value", () => {
        const foot = scan(20, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: baseline(),
            scans: [foot],
            shoeSize: shoe,
            flexibleBySide: { left: true },
        });
        if (!out.ok) throw new Error(out.reason);
        useDesignStore.setState({
            design: out.design,
            history: [],
            future: [],
            selectedElementId: null,
        });
        useDesignStore.getState().updateCorrection("left", { apexMoveMm: 1 });
        expect(useDesignStore.getState().design.corrections.left.apexMoveMm).toBe(1);
        expect(useDesignStore.getState().design.corrections.left.archHeightMm).toBe(-3.5);
        useDesignStore.getState().updateCorrection("left", { archHeightMm: 2 });
        expect(useDesignStore.getState().design.corrections.left.archHeightMm).toBe(2);
        expect(useDesignStore.getState().design.corrections.left.apexMoveMm).toBe(1);
        foot.geometry.dispose();
    });

    test("dancer pad left and medial skive right stay on their own feet", () => {
        const text = "dancer pad left, medial skive right";
        const parsed = interpretOneClickRx(text, ["left", "right"]);
        expect(parsed.elements).toEqual([{ kind: "dancers_pad", side: "left" }]);
        expect(parsed.correctionsBySide.left).toBeUndefined();
        expect(parsed.correctionsBySide.right).toEqual({ medialSkiveMm: UNSPECIFIED_MEDIAL_SKIVE_MM });
        expect(parsed.correctionsBySide.right?.medialSkiveMm).toBe(4);
        expect(ELEMENT_PROFILES.dancers_pad).toBeTruthy();

        const left = scan(24, "left");
        const right = scan(24, "right");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: baseline(),
            scans: [left, right],
            shoeSize: shoe,
            prescriptionText: text,
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.linked).toBe(false);
        expect(out.design.elements.filter((e) => e.kind === "dancers_pad").map((e) => e.side)).toEqual([
            "left",
        ]);
        expect(out.design.elements.some((e) => e.side === "right")).toBe(false);
        expect(out.design.corrections.left.medialSkiveMm).toBe(0);
        expect(out.design.corrections.right.medialSkiveMm).toBe(UNSPECIFIED_MEDIAL_SKIVE_MM);
        expect(out.design.corrections.left.archHeightMm).toBe(0);
        expect(out.design.corrections.right.archHeightMm).toBe(0);
        left.geometry.dispose();
        right.geometry.dispose();
    });
});

describe("one-click geometry matches the same controls set by hand", () => {
    test("each arch band and Flexible matches the slider mesh, including plain Standard", async () => {
        const base = await loadSampleTopGlb();
        const rows: [number, number, boolean, number][] = [
            [20, -3.5, false, 0],
            [20, -3.5, true, 4],
            [24, 0, false, 0],
            [24, 0, true, 4],
            [28, 3, false, 0],
            [28, 3, true, 4],
        ];
        try {
            for (const [measured, arch, flexible, apex] of rows) {
                const foot = scan(measured, "left");
                const source = baseline();
                const out = generateOrthoticFromScanAndRx({
                    baselineDesign: source,
                    scans: [foot],
                    shoeSize: shoe,
                    flexibleBySide: { left: flexible },
                });
                foot.geometry.dispose();
                if (!out.ok) throw new Error(`${measured}/${flexible}: ${out.reason}`);
                const hand = designByHand(source, {
                    corrections: { left: { archHeightMm: arch, apexMoveMm: apex } },
                });
                expectSameMesh(base, out.design, hand, "left");
            }
        } finally {
            base.dispose();
        }
    }, 300000);

    test("arch, Flexible, a correction, an element, and a sink match the hand path", async () => {
        const base = await loadSampleTopGlb();
        const foot = scan(20, "left");
        const source = baseline();
        const text = "Left medial skive 4 mm. Left met pad. Left 1st MPJ 2 mm";
        try {
            const out = generateOrthoticFromScanAndRx({
                baselineDesign: source,
                scans: [foot],
                shoeSize: shoe,
                flexibleBySide: { left: true },
                prescriptionText: text,
            });
            if (!out.ok) throw new Error(out.reason);
            expect(out.design.corrections.left.archHeightMm).toBe(-3.5);
            expect(out.design.corrections.left.apexMoveMm).toBe(4);
            expect(out.design.corrections.left.medialSkiveMm).toBe(4);
            expect(out.design.elements.map((e) => e.kind)).toEqual(["met_pad"]);
            expect(out.design.sinks?.left?.map((s) => ({ kind: s.kind, depthMm: s.depthMm }))).toEqual([
                { kind: "mpj1", depthMm: 2 },
            ]);
            expect(SINK_PROFILES.mpj1).toBeTruthy();
            const hand = designByHand(source, {
                corrections: { left: { archHeightMm: -3.5, apexMoveMm: 4, medialSkiveMm: 4 } },
                elements: [{ kind: "met_pad", side: "left" }],
                sinks: [{ kind: "mpj1", side: "left", depthMm: 2 }],
            });
            expectSameMesh(base, out.design, hand, "left");
        } finally {
            foot.geometry.dispose();
            base.dispose();
        }
    }, 180000);

    test("dancer pad on the left and medial skive on the right match the hand path", async () => {
        const base = await loadSampleTopGlb();
        const left = scan(24, "left");
        const right = scan(24, "right");
        const source = baseline();
        const text = "dancer pad left, medial skive right";
        try {
            const out = generateOrthoticFromScanAndRx({
                baselineDesign: source,
                scans: [left, right],
                shoeSize: shoe,
                prescriptionText: text,
            });
            if (!out.ok) throw new Error(out.reason);
            const hand = designByHand(source, {
                corrections: {
                    left: { archHeightMm: 0, apexMoveMm: 0, medialSkiveMm: 0 },
                    right: { archHeightMm: 0, apexMoveMm: 0, medialSkiveMm: UNSPECIFIED_MEDIAL_SKIVE_MM },
                },
                elements: [{ kind: "dancers_pad", side: "left" }],
            });
            expectSameMesh(base, out.design, hand, "left");
            expectSameMesh(base, out.design, hand, "right");
        } finally {
            left.geometry.dispose();
            right.geometry.dispose();
            base.dispose();
        }
    }, 180000);
});
