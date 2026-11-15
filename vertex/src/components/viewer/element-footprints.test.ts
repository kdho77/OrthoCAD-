// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Euler, Vector3 } from "three";
import { elementPlacementSides } from "@/features/clinical/ActiveFootSideBar";
import { DESIGN_ELEMENT_COLOR } from "@/lib/geometry/element-visualization";
import { defaultElementPose } from "@/lib/geometry/elements";
import { medialSign, meshYSign } from "@/lib/geometry/handedness";
import { sideOffsetX } from "@/lib/geometry/layout";
import { mortonsEdgeMm } from "@/lib/geometry/mortons-extension";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { SINK_KIND_ORDER, SINK_PROFILES, sinkCutMm, sinkFrame } from "@/lib/geometry/sink";
import { projectViewNdcX, projectViewNdcY } from "@/lib/geometry/viewport-side-layout";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { PlacedElement, PlacedSink, Side } from "@/types";
import { ElementFootprints, ElementMarkers } from "./ElementMarkers";
import {
    DESIGN_FOOTPRINT_COLORS,
    elementFootprintPose,
    footprintLocalToAnatomical,
    footprintStyle,
    footprintSurfaceZ,
    isLibrarySinkElement,
    SINK_FOOTPRINT_COLORS,
    showsDesignFootprint,
    sinkFootprintPose,
} from "./element-footprints";

rs.mock("@react-three/drei", () => ({ TransformControls: () => null }));
rs.mock("@react-three/fiber", () => ({ useThree: () => ({ controls: null }) }));
(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(...parts: string[]): string {
    const a = resolve(process.cwd(), ...parts);
    const b = resolve(process.cwd(), "vertex", ...parts);
    if (existsSync(a)) return a;
    if (existsSync(b)) return b;
    return a;
}

const layout = insoleLayoutForUsMenSize(9);

function placed(kind: PlacedElement["kind"], side: Side, id = `${kind}-${side}`): PlacedElement {
    return {
        id,
        kind,
        side,
        ...defaultElementPose(kind === "custom" ? "met_pad" : kind, side, layout.lengthMm, layout.widthMm),
    };
}

function sink(kind: PlacedSink["kind"], id = kind): PlacedSink {
    return { id, kind, depthMm: 2 };
}

function required<T>(value: T | null | undefined): T {
    if (value == null) throw new Error("expected a footprint");
    return value;
}

describe("element footprint planforms", () => {
    test("sink colors live in one set and the selected sink is a brighter magenta", () => {
        expect(SINK_FOOTPRINT_COLORS.selectedFill).toBe("#ff00ff");
        expect(SINK_FOOTPRINT_COLORS.fill.toLowerCase()).not.toBe("#22c55e");
        expect(footprintStyle(true).color).toBe(SINK_FOOTPRINT_COLORS.selectedFill);
        expect(footprintStyle(false).color).toBe(SINK_FOOTPRINT_COLORS.fill);
        expect(footprintStyle(true).edge).toBe(SINK_FOOTPRINT_COLORS.selectedEdge);
        expect(footprintStyle(true).opacity).toBeGreaterThanOrEqual(footprintStyle(false).opacity);
        expect(footprintStyle(false).opacity).toBe(1);
    });

    test("only heel and navicular library elements are sink footprints", () => {
        expect(isLibrarySinkElement(placed("kinetic_wedge", "left"))).toBe(false);
        expect(isLibrarySinkElement(placed("met_pad", "right"))).toBe(false);
        expect(isLibrarySinkElement(placed("cluffy_wedge", "left"))).toBe(false);
        expect(isLibrarySinkElement({ ...placed("met_pad", "left"), kind: "custom" })).toBe(false);
        expect(isLibrarySinkElement(placed("heel_sink", "left"))).toBe(true);
        expect(isLibrarySinkElement(placed("navicular_sink", "right"))).toBe(true);
        expect(isLibrarySinkElement(placed("mortons_extension", "left"))).toBe(false);
        expect(showsDesignFootprint(placed("mortons_extension", "right"))).toBe(true);
        expect(showsDesignFootprint(placed("reverse_mortons", "left"))).toBe(true);
        expect(showsDesignFootprint(placed("kinetic_wedge", "right"))).toBe(true);
        expect(showsDesignFootprint(placed("cluffy_wedge", "left"))).toBe(false);

        const heel = elementFootprintPose(placed("heel_sink", "left"), layout.lengthMm);
        expect(heel.kind).toBe("element");
        expect(heel.halfLengthMm).toBeCloseTo(heel.halfWidthMm, 0);
        expect(heel.outline.length).toBeGreaterThan(8);

        const navicular = placed("navicular_sink", "right", "nav");
        const base = elementFootprintPose(navicular, layout.lengthMm);
        expect(Math.abs(base.halfLengthMm - base.halfWidthMm)).toBeGreaterThan(0.5);
        const grown = elementFootprintPose({ ...navicular, scale: { x: 1.4, y: 0.8 } }, layout.lengthMm);
        expect(grown.halfLengthMm).toBeGreaterThan(base.halfLengthMm);
        expect(grown.halfWidthMm).toBeLessThan(base.halfWidthMm);
        const moved = elementFootprintPose(
            {
                ...navicular,
                position: { x: navicular.position.x + 12, y: navicular.position.y - 4 },
                rotationDeg: 25,
            },
            layout.lengthMm,
        );
        expect(moved.x - base.x).toBeCloseTo(12, 5);
        expect(moved.y - base.y).toBeCloseTo(-4, 5);
        expect(moved.rotationDeg).toBe(25);
    });

    test("sink ovals match the cut frame on both feet and follow u and v edits", () => {
        for (const side of ["left", "right"] as const) {
            const placedSink = sink("mpj2");
            const frame = required(
                sinkFrame(placedSink, {
                    side,
                    lengthMm: layout.lengthMm,
                    widthMm: layout.widthMm,
                    sinks: [placedSink],
                }),
            );
            const pose = required(sinkFootprintPose(placedSink, side, layout.lengthMm, layout.widthMm));
            expect(pose.halfLengthMm).toBeCloseTo(frame.halfLengthMm, 5);
            expect(pose.halfWidthMm).toBeCloseTo(frame.halfWidthMm, 5);
            expect(Math.abs(pose.halfLengthMm - pose.halfWidthMm)).toBeLessThan(1e-6);
            const center = footprintLocalToAnatomical(pose, 0, 0);
            expect(center.x).toBeCloseTo(frame.cx, 4);
            expect(center.yLateral).toBeCloseTo(frame.cy, 4);
            const tip = footprintLocalToAnatomical(pose, pose.halfLengthMm, 0);
            const dx = tip.x - frame.cx;
            const dy = tip.yLateral - frame.cy;
            const len = Math.hypot(dx, dy);
            expect(dx / len).toBeCloseTo(frame.tx, 4);
            expect(dy / len).toBeCloseTo(frame.ty, 4);
            const ctx = { side, lengthMm: layout.lengthMm, widthMm: layout.widthMm, sinks: [placedSink] };
            expect(sinkCutMm(center.x, center.yLateral, ctx).mm).toBeGreaterThan(1);
            const outside = footprintLocalToAnatomical(pose, pose.halfLengthMm + frame.blendMm + 2, 0);
            expect(sinkCutMm(outside.x, outside.yLateral, ctx).mm).toBe(0);
        }
        const left = required(sinkFootprintPose(sink("mpj1"), "left", layout.lengthMm, layout.widthMm));
        const right = required(sinkFootprintPose(sink("mpj1"), "right", layout.lengthMm, layout.widthMm));
        expect(Math.sign(left.y)).toBe(medialSign("left"));
        expect(Math.sign(right.y)).toBe(medialSign("right"));
        expect(left.x).toBeCloseTo(right.x, 4);

        const moved = required(
            sinkFootprintPose(
                { id: "mpj2", kind: "mpj2", depthMm: 2, u: 0.4, v: 0.5 },
                "right",
                layout.lengthMm,
                layout.widthMm,
            ),
        );
        const origin = required(sinkFootprintPose(sink("mpj2"), "right", layout.lengthMm, layout.widthMm));
        expect(Math.hypot(moved.x - origin.x, moved.y - origin.y)).toBeGreaterThan(5);

        const styloid = required(sinkFootprintPose(sink("styloid"), "left", layout.lengthMm, layout.widthMm));
        expect(Math.abs(styloid.halfLengthMm - styloid.halfWidthMm)).toBeGreaterThan(1);
        expect(styloid.rotationDeg).not.toBe(0);
    });

    test("a footprint on either foot projects inside the Top and Bottom cameras", () => {
        const design = useDesignStore.getInitialState().design;
        const pose = required(sinkFootprintPose(sink("mpj1"), "right", layout.lengthMm, layout.widthMm));
        const z = footprintSurfaceZ(design, "right", pose.x, pose.y, layout.lengthMm, layout.widthMm);
        expect(z).toBeGreaterThan(design.thicknessMm);
        const local = new Vector3(
            pose.x - layout.lengthMm / 2,
            pose.y + sideOffsetX("right", layout.widthMm),
            z,
        );
        local.applyEuler(new Euler(-Math.PI / 2, 0, 0));
        for (const view of ["top", "bottom"] as const) {
            expect(Math.abs(projectViewNdcX(view, local))).toBeLessThan(1);
            expect(Math.abs(projectViewNdcY(view, local))).toBeLessThan(1);
        }
    });

    test("overlay is display-only and draws from both cameras", () => {
        const src = readFileSync(repoFile("src/components/viewer/ElementMarkers.tsx"), "utf8");
        const math = readFileSync(repoFile("src/components/viewer/element-footprints.ts"), "utf8");
        expect(src).toMatch(/depthTest=\{false\}/);
        expect(src).toMatch(/transparent=\{style\.opacity < 1\}/);
        expect(src).toMatch(/opacity=\{style\.opacity\}/);
        expect(src).toMatch(/DoubleSide/);
        expect(src).toMatch(/ElementFootprints/);
        expect(src).not.toMatch(/cylinderGeometry/i);
        expect(src).not.toMatch(/applySinkCut/);
        expect(src).not.toMatch(/applyElementsToTopMesh/);
        expect(math).not.toMatch(/applySinkCut/);
        expect(math).toMatch(/selectedFill: "#ff00ff"/);
        expect(src).toMatch(/isLibrarySinkElement/);
    });
});

describe("element footprint overlay", () => {
    let root: Root;
    let container: HTMLDivElement;

    beforeEach(() => {
        const design = JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
        design.elements = [
            placed("cluffy_wedge", "left", "wedge-l"),
            placed("cluffy_wedge", "right", "wedge-r"),
            placed("met_pad", "left", "pad-l"),
            placed("heel_sink", "left", "heel-l"),
            placed("navicular_sink", "right", "nav-r"),
        ];
        design.sinks = {
            left: [sink("mpj1", "sink-l")],
            right: [sink("styloid", "sink-r")],
        };
        useDesignStore.setState({
            design,
            selectedElementId: null,
            viewer: { ...useDesignStore.getState().viewer, showLeft: true, showRight: true },
        });
        useClinicalWorkflowStore.setState({ step: "elements" });
        usePerformanceStore.getState().clearAllPreviews();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        usePerformanceStore.getState().clearAllPreviews();
    });

    function footprintNames(): string[] {
        return [...container.querySelectorAll("mesh")].map((node) => node.getAttribute("name") ?? "");
    }

    test("draws sink patches only, and hides a foot that is off", async () => {
        await act(async () => root.render(createElement(ElementFootprints)));
        const names = footprintNames();
        expect(names.some((n) => n.includes("element:heel-l"))).toBe(true);
        expect(names.some((n) => n.includes("element:nav-r"))).toBe(true);
        expect(names.some((n) => n.includes("sink:sink-l"))).toBe(true);
        expect(names.some((n) => n.includes("sink:sink-r"))).toBe(true);
        expect(names.some((n) => n.includes("wedge") || n.includes("pad-l"))).toBe(false);
        expect(names.every((n) => n.includes(SINK_FOOTPRINT_COLORS.fill))).toBe(true);
        await act(async () => useDesignStore.getState().setViewer({ showRight: false }));
        const leftOnly = footprintNames();
        expect(leftOnly.some((n) => n.includes("heel-l"))).toBe(true);
        expect(leftOnly.some((n) => n.includes("sink-l"))).toBe(true);
        expect(leftOnly.some((n) => n.includes("nav-r") || n.includes("sink-r") || n.includes("wedge"))).toBe(
            false,
        );
    });

    test("the selected sink is brighter magenta and a live edit moves the patch", async () => {
        await act(async () => root.render(createElement(ElementMarkers)));
        const before = footprintNames().find((n) => n.includes("heel-l")) ?? "";
        expect(before).toContain(SINK_FOOTPRINT_COLORS.fill);
        await act(async () => useDesignStore.getState().selectElement("wedge-l"));
        expect(footprintNames().some((n) => n.includes("wedge"))).toBe(false);
        expect(footprintNames().every((n) => n.includes(SINK_FOOTPRINT_COLORS.fill))).toBe(true);
        await act(async () => useDesignStore.getState().selectElement("heel-l"));
        const selected = footprintNames().find((n) => n.includes("heel-l")) ?? "";
        expect(selected).toContain(SINK_FOOTPRINT_COLORS.selectedFill);
        const others = footprintNames().filter((n) => !n.includes("heel-l"));
        expect(others.every((n) => n.includes(SINK_FOOTPRINT_COLORS.fill))).toBe(true);
        await act(async () =>
            usePerformanceStore.getState().setElementPreview("heel-l", {
                id: "heel-l",
                position: { x: 30, y: -6 },
                scale: { x: 1.5, y: 0.7 },
            }),
        );
        const edited = footprintNames().find((n) => n.includes("heel-l")) ?? "";
        expect(edited).not.toBe(selected);
        expect(edited).toContain(":160.0:");
        expect(footprintNames().some((n) => n.includes("wedge") || n.includes("pad-l"))).toBe(false);
        const beforeSink = footprintNames().find((n) => n.includes("sink:sink-l")) ?? "";
        await act(async () => useDesignStore.getState().updateSink("sink-l", { u: 0.2, v: 0.5 }, "left"));
        const movedSink = footprintNames().find((n) => n.includes("sink:sink-l")) ?? "";
        expect(movedSink).not.toBe(beforeSink);
        const sinkMesh = [...container.querySelectorAll("mesh")].find((node) =>
            (node.getAttribute("name") ?? "").includes("sink:sink-l"),
        );
        await act(async () => {
            required(sinkMesh).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(useDesignStore.getState().selectedElementId).toBeNull();
        expect(footprintNames().find((n) => n.includes("sink:sink-l"))).toContain(
            SINK_FOOTPRINT_COLORS.selectedFill,
        );
    });

    test("Morton's extension draws a purple medial planform and wedges stay hidden", async () => {
        const design = JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
        design.elements = [
            placed("mortons_extension", "left", "mort-l"),
            placed("mortons_extension", "right", "mort-r"),
            placed("kinetic_wedge", "left", "wedge-l"),
        ];
        design.sinks = { left: [], right: [] };
        useDesignStore.setState({
            design,
            selectedElementId: null,
            viewer: { ...useDesignStore.getState().viewer, showLeft: true, showRight: true },
        });
        await act(async () => root.render(createElement(ElementFootprints)));
        const names = footprintNames();
        expect(names.some((n) => n.includes("element:mort-l") && n.includes(DESIGN_ELEMENT_COLOR))).toBe(
            true,
        );
        expect(names.some((n) => n.includes("element:mort-r") && n.includes(DESIGN_ELEMENT_COLOR))).toBe(
            true,
        );
        expect(names.some((n) => n.includes("element:wedge-l") && n.includes("#38bdf8"))).toBe(true);
        expect(DESIGN_FOOTPRINT_COLORS.fill).toBe(DESIGN_ELEMENT_COLOR);
        const leftPose = elementFootprintPose(placed("mortons_extension", "left", "mort-l"), layout.lengthMm);
        const rightPose = elementFootprintPose(
            placed("mortons_extension", "right", "mort-r"),
            layout.lengthMm,
        );
        expect(Math.sign(leftPose.y)).toBe(medialSign("left"));
        expect(Math.sign(rightPose.y)).toBe(medialSign("right"));
        expect(leftPose.y).toBeLessThan(0);
        expect(rightPose.y).toBeGreaterThan(0);
        expect(rightPose.y).toBeCloseTo(-leftPose.y, 5);
        expect(leftPose.x).toBeGreaterThan(layout.lengthMm * 0.65);
    });

    test("every registered sink draws a visible planform on its anatomical side", async () => {
        const design = JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
        design.elements = [];
        design.sinks = {
            left: SINK_KIND_ORDER.map((kind) => ({ id: `L-${kind}`, kind, depthMm: 2 })),
            right: SINK_KIND_ORDER.map((kind) => ({ id: `R-${kind}`, kind, depthMm: 2 })),
        };
        useDesignStore.setState({
            design,
            selectedElementId: null,
            viewer: { ...useDesignStore.getState().viewer, showLeft: true, showRight: true },
        });
        await act(async () => root.render(createElement(ElementFootprints)));
        const names = footprintNames();
        expect(footprintStyle(false).opacity).toBeGreaterThan(0.85);
        expect(names.length).toBe((SINK_KIND_ORDER.length - 1) * 2);
        expect(names.some((n) => n.includes("mpj1"))).toBe(false);
        for (const kind of SINK_KIND_ORDER) {
            if (kind === "mpj1") continue;
            const fill = SINK_FOOTPRINT_COLORS.fill;
            expect(names.some((n) => n.includes(`sink:L-${kind}`) && n.includes(fill))).toBe(true);
            expect(names.some((n) => n.includes(`sink:R-${kind}`) && n.includes(fill))).toBe(true);
            const anatomical = SINK_PROFILES[kind].anatomicalSide;
            if (anatomical === "midline") continue;
            const left = required(
                sinkFootprintPose(
                    { id: `L-${kind}`, kind, depthMm: 2 },
                    "left",
                    layout.lengthMm,
                    layout.widthMm,
                ),
            );
            const right = required(
                sinkFootprintPose(
                    { id: `R-${kind}`, kind, depthMm: 2 },
                    "right",
                    layout.lengthMm,
                    layout.widthMm,
                ),
            );
            expect(Math.sign(left.y)).toBe(meshYSign("left", anatomical));
            expect(Math.sign(right.y)).toBe(meshYSign("right", anatomical));
            expect(right.y).not.toBeCloseTo(left.y, 3);
        }
    });

    test("print and export do not mount the overlay", async () => {
        for (const step of ["print", "export"] as const) {
            useClinicalWorkflowStore.setState({ step });
            await act(async () => root.render(createElement(ElementMarkers)));
            expect(container.querySelector("mesh")).toBeNull();
        }
    });
});

describe("Morton's and Reverse Morton's first-ray footprints", () => {
    function boxOutline(length: number, half: number): { x: number; y: number }[] {
        const pts: { x: number; y: number }[] = [];
        const n = 12;
        for (let i = 0; i <= n; i++) pts.push({ x: (i / n) * length, y: -half });
        for (let i = n; i >= 0; i--) pts.push({ x: (i / n) * length, y: half });
        return pts;
    }

    function worldRing(
        element: PlacedElement,
        lengthMm: number,
        widthMm: number,
        outline?: { x: number; y: number }[] | null,
    ): { x: number; y: number }[] {
        const pose = elementFootprintPose(element, lengthMm, widthMm, outline);
        return pose.outline.map((p) => ({ x: pose.x + p.x, y: pose.y + p.y }));
    }

    function expectFirstRay(
        ring: { x: number; y: number }[],
        side: Side,
        widthMm: number,
        toeX: number,
        outline?: { x: number; y: number }[] | null,
    ) {
        const xs = ring.map((p) => p.x);
        const ys = ring.map((p) => p.y);
        expect(Math.max(...xs)).toBeCloseTo(toeX, 0);
        const medial = side === "left" ? Math.min(...ys) : Math.max(...ys);
        let border = side === "left" ? Infinity : -Infinity;
        for (let i = 0; i <= 16; i++) {
            const u = 0.63 + (0.37 * i) / 16;
            const y = mortonsEdgeMm(u, widthMm, side, outline).medial;
            border = side === "left" ? Math.min(border, y) : Math.max(border, y);
        }
        expect(Math.abs(medial - border)).toBeLessThan(2);
        if (side === "left") expect(Math.max(...ys)).toBeLessThan(0);
        else expect(Math.min(...ys)).toBeGreaterThan(0);
        expect(Math.sign(ys.reduce((sum, y) => sum + y, 0) / ys.length)).toBe(meshYSign(side, "medial"));
    }

    function facesPartner(view: "top" | "bottom", side: Side, meshX: number, meshY: number, widthMm: number) {
        const ndc = (y: number) => {
            const world = new Vector3(meshX, sideOffsetX(side, widthMm) + y, 4).applyEuler(
                new Euler(-Math.PI / 2, 0, 0),
            );
            return projectViewNdcX(view, world);
        };
        return Math.abs(ndc(meshY)) < Math.abs(ndc(0));
    }

    test("left and right rings sit on the medial first ray and end on the toe", () => {
        const layout = insoleLayoutForUsMenSize(11.5);
        const { lengthMm, widthMm } = layout;
        const outline = boxOutline(lengthMm - 8, widthMm * 0.42);
        const toe = Math.max(...outline.map((p) => p.x));
        for (const frame of [undefined, outline] as const) {
            const rings = new Map<string, { x: number; y: number }[]>();
            for (const kind of ["mortons_extension", "reverse_mortons"] as const) {
                for (const side of ["left", "right"] as const) {
                    const pose = defaultElementPose(kind, side, lengthMm, widthMm, frame);
                    const ring = worldRing(
                        { id: `${kind}-${side}`, kind, side, ...pose },
                        lengthMm,
                        widthMm,
                        frame,
                    );
                    rings.set(`${kind}:${side}`, ring);
                    expectFirstRay(ring, side, widthMm, frame ? toe : lengthMm, frame);
                    const meanX = ring.reduce((sum, p) => sum + p.x, 0) / ring.length - lengthMm / 2;
                    const meanY = ring.reduce((sum, p) => sum + p.y, 0) / ring.length;
                    expect(facesPartner("top", side, meanX, meanY, widthMm)).toBe(true);
                    expect(facesPartner("bottom", side, meanX, meanY, widthMm)).toBe(true);
                }
            }
            for (const side of ["left", "right"] as const) {
                const raised = required(rings.get(`mortons_extension:${side}`));
                const lowered = required(rings.get(`reverse_mortons:${side}`));
                expect(lowered.length).toBe(raised.length);
                for (let i = 0; i < raised.length; i++) {
                    const a = required(lowered[i]);
                    const b = required(raised[i]);
                    expect(a.x).toBeCloseTo(b.x, 4);
                    expect(a.y).toBeCloseTo(b.y, 4);
                }
            }
            const left = required(rings.get("mortons_extension:left"));
            const right = required(rings.get("mortons_extension:right"));
            expect(right.length).toBe(left.length);
            for (let i = 0; i < left.length; i++) {
                const l = required(left[i]);
                const r = required(right[i]);
                expect(r.x).toBeCloseTo(l.x, 4);
                expect(r.y).toBeCloseTo(-l.y, 4);
            }
        }
    });

    test("Both (linked) places each pad on the medial first ray of both feet", () => {
        const layout = insoleLayoutForUsMenSize(11.5);
        useClinicalWorkflowStore.setState({ elementPlacementFoot: "both" });
        expect(elementPlacementSides()).toEqual(["left", "right"]);
        for (const kind of ["mortons_extension", "reverse_mortons"] as const) {
            const design = JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
            design.usMenSize = 11.5;
            design.sizeSystem = "us";
            design.elements = [];
            useDesignStore.setState({ design, selectedElementId: null });
            for (const side of elementPlacementSides()) {
                useDesignStore.getState().addElement(kind, side);
            }
            const placedElements = useDesignStore.getState().design.elements;
            expect(placedElements.map((el) => el.side).sort()).toEqual(["left", "right"]);
            expect(placedElements.every((el) => el.kind === kind && el.heightMm === 3)).toBe(true);
            for (const el of placedElements) {
                const ring = worldRing(el, layout.lengthMm, layout.widthMm);
                expectFirstRay(ring, el.side, layout.widthMm, layout.lengthMm);
                const pose = defaultElementPose(kind, el.side, layout.lengthMm, layout.widthMm);
                expect(el.position).toEqual(pose.position);
            }
        }
        useClinicalWorkflowStore.setState({ elementPlacementFoot: "both" });
    });
});
