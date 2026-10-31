// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import JSZip from "jszip";
import type { BufferGeometry } from "three";
import { packOrder3mf } from "@/features/exports/export-service";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { generateCncJob } from "@/lib/cnc/export";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import {
    buildExportGeometry,
    buildOrderPairGeometry,
    orderDownloadSides,
} from "@/lib/geometry/export-geometry";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { defaultSideShapeFinish } from "@/lib/geometry/shape-finish-modifiers";
import { insoleLayoutForUsMenSize, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { generateGcode, PRINTER_PRESETS } from "@/lib/kiri";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import { loadSampleTop } from "./cnc/helpers";

const SAMPLE_TOP_FIXTURE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function span(geo: {
    getAttribute: (name: string) => {
        count: number;
        getX: (i: number) => number;
        getY: (i: number) => number;
        getZ: (i: number) => number;
    } | null;
}) {
    const pos = geo.getAttribute("position");
    if (!pos) throw new Error("mesh has no position");
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
        minZ = Math.min(minZ, pos.getZ(i));
        maxZ = Math.max(maxZ, pos.getZ(i));
    }
    return { length: maxX - minX, width: maxY - minY, minZ, maxZ, minX, maxX, minY, maxY };
}

function localMaxZ(
    geo: {
        getAttribute: (
            name: string,
        ) => { count: number; getX: (i: number) => number; getZ: (i: number) => number } | null;
    },
    x0: number,
    x1: number,
): number {
    const pos = geo.getAttribute("position");
    if (!pos) throw new Error("mesh has no position");
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        if (x < x0 || x > x1) continue;
        maxZ = Math.max(maxZ, pos.getZ(i));
    }
    return maxZ;
}

function meshSpan(positions: Float32Array) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        minX = Math.min(minX, positions[i]!);
        maxX = Math.max(maxX, positions[i]!);
        minY = Math.min(minY, positions[i + 1]!);
        maxY = Math.max(maxY, positions[i + 1]!);
        maxZ = Math.max(maxZ, positions[i + 2]!);
    }
    return { length: maxX - minX, width: maxY - minY, minY, maxY, maxZ };
}

function metPad(side: Side): PlacedElement {
    return {
        id: `met-${side}`,
        kind: "met_pad",
        side,
        position: { x: 20, y: 0 },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        heightMm: 5,
    };
}

function install(design: DesignState) {
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({
        design,
        viewer: { ...viewer, wallModel: "procedural", wallStyle: "straight" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

async function orderTop(design: DesignState, side: Side, raw: BufferGeometry, width: "medium" | "wide") {
    const layout = insoleLayoutForUsMenSize(design.usMenSize ?? 9);
    const sized = scaleGeometryToInsoleSize(raw, layout.lengthMm, layout.widthMm);
    const thickness = design.paired
        ? side === "left"
            ? design.paired.leftThicknessMm
            : design.paired.rightThicknessMm
        : design.thicknessMm;
    const field = baseModifierFieldAuthoritative(design, side, thickness);
    const composed = await composePrintSolidTop(sized, {
        sourceField: field,
        shoeWidth: {
            width,
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
            heelOverrideMm: field.corrections?.heelCupWidthMm ?? 0,
        },
    });
    if (sized !== composed) sized.dispose();
    return composed;
}

describe("downloads match the order build", () => {
    beforeEach(() => {
        resetSampleTopGeometryCache();
        const buf = readFileSync(SAMPLE_TOP_FIXTURE);
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("SAMPLE_Top")) {
                return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
            }
            throw new Error(`unexpected fetch ${url}`);
        }) as typeof fetch;
    });

    afterEach(() => {
        resetSampleTopGeometryCache();
    });

    test("STL, 3MF, print G-code and CNC include elements, Wide and size 7.5", async () => {
        const layout = insoleLayoutForUsMenSize(7.5);
        const design = createDesignWithStockPlaceholder();
        design.usMenSize = 7.5;
        design.shoeWidth = "wide";
        design.shoeWidthBySide = { left: "wide", right: "wide" };
        design.elements = [metPad("left"), metPad("right")];
        install(design);

        const sample = await loadSampleTop();
        const native = span(sample);
        const wide = await orderTop(design, "left", sample, "wide");
        const mediumDesign = createDesignWithStockPlaceholder();
        mediumDesign.usMenSize = 7.5;
        mediumDesign.elements = [metPad("left")];
        const medium = await orderTop(mediumDesign, "left", sample, "medium");
        const plainDesign = createDesignWithStockPlaceholder();
        plainDesign.usMenSize = 7.5;
        plainDesign.shoeWidth = "wide";
        plainDesign.shoeWidthBySide = { left: "wide", right: "wide" };
        const plain = await orderTop(plainDesign, "left", sample, "wide");

        const wideBox = span(wide);
        const mediumBox = span(medium);
        const widePos = wide.getAttribute("position");
        const plainPos = plain.getAttribute("position");
        if (!widePos || !plainPos || widePos.count !== plainPos.count) {
            throw new Error(`element compose vertex mismatch ${widePos?.count} vs ${plainPos?.count}`);
        }
        let elementRaise = 0;
        let raiseX = 0;
        for (let i = 0; i < widePos.count; i++) {
            const dz = widePos.getZ(i) - plainPos.getZ(i);
            if (dz > elementRaise) {
                elementRaise = dz;
                raiseX = widePos.getX(i);
            }
        }
        expect(elementRaise).toBeGreaterThan(0.3);
        expect(wideBox.width - mediumBox.width).toBeGreaterThan(3);
        expect(wideBox.width - mediumBox.width).toBeLessThan(8);
        expect(wideBox.length).toBeGreaterThan(layout.lengthMm + 5 - 1.5);
        expect(wideBox.length).toBeLessThan(layout.lengthMm + 5 + 1.5);

        const sizes: Record<string, { native: number; orderLength: number; shoe: number }> = {
            "7.5": { native: native.length, orderLength: wideBox.length, shoe: layout.lengthMm },
        };
        for (const size of [9, 12] as const) {
            const sizedDesign = createDesignWithStockPlaceholder();
            sizedDesign.usMenSize = size;
            const top = await orderTop(sizedDesign, "left", sample, "medium");
            const box = span(top);
            const shoe = insoleLayoutForUsMenSize(size).lengthMm;
            expect(box.length).toBeGreaterThan(shoe + 5 - 1.5);
            expect(box.length).toBeLessThan(shoe + 5 + 1.5);
            sizes[String(size)] = { native: native.length, orderLength: box.length, shoe };
            top.dispose();
        }

        const leftSolid = await buildExportGeometry("left");
        const leftBox = span(leftSolid);
        expect(Math.abs(leftBox.length - wideBox.length)).toBeLessThan(2);
        expect(Math.abs(leftBox.width - wideBox.width)).toBeLessThan(2);
        expect(leftBox.maxZ).toBeGreaterThan(wideBox.maxZ - 0.5);
        design.elements = [];
        install(design);
        const bareSolid = await buildExportGeometry("left");
        design.elements = [metPad("left"), metPad("right")];
        install(design);
        let solidRaise = -Infinity;
        for (let x = raiseX - 40; x <= raiseX + 40; x += 5) {
            const dz = localMaxZ(leftSolid, x, x + 10) - localMaxZ(bareSolid, x, x + 10);
            if (Number.isFinite(dz)) solidRaise = Math.max(solidRaise, dz);
        }
        if (!(solidRaise > 0.3)) {
            throw new Error(`export solid element raise ${solidRaise} mm at compose x ${raiseX}`);
        }
        leftSolid.dispose();
        bareSolid.dispose();

        const pair = await buildOrderPairGeometry();
        const pairBox = span(pair);
        const gap = layout.widthMm + 30;
        expect(orderDownloadSides(design)).toEqual(["left", "right"]);
        expect(pairBox.width).toBeGreaterThan(wideBox.width + gap * 0.8);
        const stl = geometryToBinarySTL(pair);
        const stlMesh = parseBinaryStl(stl);
        const stlBox = meshSpan(stlMesh.positions);
        expect(Math.abs(stlBox.length - pairBox.length)).toBeLessThan(0.05);
        expect(Math.abs(stlBox.width - pairBox.width)).toBeLessThan(0.05);

        const desktop = PRINTER_PRESETS.find((p) => p.id === "desktop-fdm");
        if (!desktop) throw new Error("desktop preset missing");
        const printed = generateGcode(pair, desktop, { layerHeightMm: 2 });
        expect(printed.gcode).toContain("slow_down_layer_time = 0");
        expect(printed.moveCount).toBeGreaterThan(10);
        const moves = [...printed.gcode.matchAll(/G1 X([-\d.]+) Y([-\d.]+)/g)];
        expect(moves.length).toBeGreaterThan(0);
        for (const m of moves) {
            const x = Number(m[1]);
            const y = Number(m[2]);
            expect(x).toBeGreaterThan(pairBox.minX - 2);
            expect(x).toBeLessThan(pairBox.maxX + 2);
            expect(y).toBeGreaterThan(pairBox.minY - 2);
            expect(y).toBeLessThan(pairBox.maxY + 2);
        }
        pair.dispose();

        const packed = await packOrder3mf(design, ["left", "right"]);
        const zip = await JSZip.loadAsync(packed.bytes);
        const model = await zip.file("3D/3dmodel.model")?.async("string");
        const settings = await zip.file("Metadata/model_settings.config")?.async("string");
        expect(model).toBeTruthy();
        expect(settings).toContain('key="slow_down_layer_time" value="0"');
        expect(settings?.match(/subtype="normal_part"/g)?.length).toBe(2);
        const verts = [...(model ?? "").matchAll(/x="([-\d.]+)" y="([-\d.]+)" z="([-\d.]+)"/g)];
        expect(verts.length).toBeGreaterThan(100);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const v of verts) {
            const x = Number(v[1]);
            const y = Number(v[2]);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        expect(Math.abs(maxX - minX - stlBox.length)).toBeLessThan(0.2);
        expect(Math.abs(maxY - minY - stlBox.width)).toBeLessThan(0.2);

        const one = createDesignWithStockPlaceholder();
        if (one.paired) one.paired.rightBase = undefined;
        expect(orderDownloadSides(one)).toEqual(["left"]);

        const profile = cloneProfile(IDAHO_PROFILE);
        const mill = defaultSideShapeFinish("milling_3axis");
        const cncDesign = createDesignWithStockPlaceholder();
        cncDesign.usMenSize = 7.5;
        cncDesign.method = "milling_3axis";
        cncDesign.shoeWidth = "wide";
        cncDesign.shoeWidthBySide = { left: "wide", right: "wide" };
        cncDesign.elements = [metPad("left"), metPad("right")];
        cncDesign.shapeFinish = { left: mill, right: { ...mill }, linked: true };
        if (cncDesign.paired) {
            cncDesign.paired.leftMethod = "milling_3axis";
            cncDesign.paired.rightMethod = "milling_3axis";
        }
        const cncOrder = await orderTop(cncDesign, "left", sample, "wide");
        const cncBox = span(cncOrder);
        const parts = await workpiecesFromDesign(cncDesign, ["left", "right"], profile, async (side) => {
            const geo = sample.clone();
            return side === "right" ? mirrorGeometry(geo) : geo;
        });
        expect(parts).toHaveLength(2);
        for (const part of parts) {
            const box = span(part.mesh!);
            expect(Math.abs(box.length - cncBox.length)).toBeLessThan(1.5);
            expect(Math.abs(box.width - cncBox.width)).toBeLessThan(1.5);
            expect(box.length).toBeGreaterThan(layout.lengthMm - 1);
            expect(box.length).toBeLessThan(layout.lengthMm + 1);
        }
        const job = generateCncJob(profile, parts);
        expect(job.gcode).toContain("; foot: left+right");
        expect(job.gcode).toContain("G0 X0.0000 Y0.0000 Z");
        expect(job.gcode).toContain("G21");
        expect(job.gcode).toContain("G90");

        writeFileSync(
            "/tmp/stl-dims.json",
            JSON.stringify(
                {
                    nativeSampleTopLengthMm: native.length,
                    printOrderLengthMm: sizes,
                    exportSolid75: { length: leftBox.length, width: leftBox.width, maxZ: leftBox.maxZ },
                    orderTop75: wideBox,
                    pair: { length: pairBox.length, width: pairBox.width },
                    cnc75: { length: cncBox.length, width: cncBox.width },
                    note: "Print orders include the default +5 mm trimmable forefoot. Milling shape finish does not.",
                },
                null,
                2,
            ),
        );

        for (const part of parts) part.mesh?.dispose();
        cncOrder.dispose();
        wide.dispose();
        medium.dispose();
        plain.dispose();
        sample.dispose();
    }, 420_000);
});
