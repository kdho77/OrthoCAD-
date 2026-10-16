// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    getBaseFootprintFrame,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import { encodePng, renderMesh } from "../../../../../tests/helpers/render-png";
import { applyElementsToTopMeshLast } from "./apply-elements";
import { loadTransformedAssetPositions, resolvePlacedAssetContexts } from "./element-asset";
import { gridFootprintBounds, sampleGridBilinear } from "./height-grid";
import { anchorMmFromPlacement, defaultNoFlowHeightHooks, smoothMaxMm } from "./no-flow-blend";
import { anchorPositionFromSidecar, elementSizeScale, localWidthAtU } from "./sizing";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const ARTIFACT_DIR = resolve("/opt/cursor/artifacts");

function zero(): SideCorrections {
    return {
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
}

async function loadSampleTop(side: Side): Promise<BufferGeometry> {
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const m = mirrorGeometry(raw);
        raw.dispose();
        raw = m;
    }
    return raw;
}

function fieldWith(raw: BufferGeometry, side: Side, el: PlacedElement): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, side);
    return {
        side,
        lengthMm: frame.lenSize,
        widthMm: frame.widSize,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements: [el],
        includeSkives: false,
        includeElements: true,
        trimline: null,
    };
}

async function defaultMetPad(
    raw: BufferGeometry,
    side: Side,
    mode: "flow" | "noFlow" = "noFlow",
    patch?: Partial<PlacedElement>,
): Promise<PlacedElement> {
    const ctx = await resolvePlacedAssetContexts(
        [
            {
                id: "probe",
                kind: "met_pad",
                side,
                position: { x: 0, y: 0 },
                rotationDeg: 0,
                scale: { x: 1, y: 1 },
                heightMm: 5,
                placementMode: mode,
            },
        ],
        side,
        1,
        1,
        raw,
    );
    const sidecar = ctx[0]!.sidecar;
    const pose = anchorPositionFromSidecar(raw, side, sidecar);
    return {
        id: "met-1",
        kind: "met_pad",
        side,
        position: { x: pose.x, y: pose.y },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        heightMm: 5,
        placementMode: mode,
        ...patch,
    };
}

function meshIndex(geo: BufferGeometry): ArrayLike<number> {
    const idx = geo.getIndex();
    if (idx) return idx.array;
    const n = geo.getAttribute("position")!.count;
    const out = new Uint32Array(Math.floor(n / 3) * 3);
    for (let i = 0; i < out.length; i++) out[i] = i;
    return out;
}

function writeRender(name: string, geo: BufferGeometry): string {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const pos = geo.getAttribute("position")!.array as Float32Array;
    const rgb = renderMesh(
        pos,
        meshIndex(geo),
        { right: [0, 1, 0], up: [0, 0, 1], light: [0.2, 0.3, 0.9] },
        900,
        700,
        [80, 170, 210],
    );
    const file = resolve(ARTIFACT_DIR, name);
    writeFileSync(file, encodePng(900, 700, rgb));
    return file;
}

describe("met pad GLB height-field asset", () => {
    test("ref size RIGHT default anchor — lift matches envelope (0.05 XY / 0.02 z)", async () => {
        const native = await loadSampleTop("right");
        const nativeFrame = getBaseFootprintFrame(native, "right");
        const raw = scaleGeometryToInsoleSize(native, 260, nativeFrame.widSize * (260 / nativeFrame.lenSize));
        native.dispose();
        const el = await defaultMetPad(raw, "right", "noFlow");
        const sizeAtRef = elementSizeScale(
            raw,
            "right",
            (await resolvePlacedAssetContexts([el], "right", 1, 1, raw))[0]!.sidecar,
        );
        expect(sizeAtRef.scaleAlong).toBeCloseTo(1, 3);
        expect(sizeAtRef.rawAlong).toBeCloseTo(1, 3);
        const field = fieldWith(raw, "right", el);
        const plain = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
        const composed = plain.clone();
        await applyElementsToTopMeshLast(composed, raw, field, { subdivide: false });
        const ctx = await resolvePlacedAssetContexts([el], "right", field.lengthMm, field.widthMm, raw);
        const { grid } = await loadTransformedAssetPositions(ctx[0]!.assetId, ctx[0]!.transform);
        const anchor = anchorMmFromPlacement(raw, "right", el.position.x, el.position.y);
        const ta = anchor.frame.thickAxis;
        const a = plain.getAttribute("position")!.array as Float32Array;
        const b = composed.getAttribute("position")!.array as Float32Array;
        const baseZ = defaultNoFlowHeightHooks.baseHeightAtAnchor(plain, anchor.x, anchor.y, ta);
        let worstZ = 0;
        let nInterior = 0;
        const lifted: { x: number; y: number }[] = [];
        for (let i = 0; i < a.length / 3; i++) {
            const lift = b[i * 3 + ta]! - a[i * 3 + ta]!;
            const dx = b[i * 3]! - anchor.x;
            const dy = b[i * 3 + 1]! - anchor.y;
            const env = sampleGridBilinear(grid, dx, dy);
            if (env > 0.3) {
                const stamp = baseZ + env;
                if (stamp <= a[i * 3 + ta]! + 0.05) continue;
                const expected = smoothMaxMm(a[i * 3 + ta]!, stamp);
                worstZ = Math.max(worstZ, Math.abs(b[i * 3 + ta]! - expected));
                nInterior++;
            }
            if (lift > 0.05) lifted.push({ x: b[i * 3]!, y: b[i * 3 + 1]! });
        }
        console.log("MET-PAD-ENVELOPE", { nInterior, worstZ, lifted: lifted.length });
        expect(nInterior).toBeGreaterThan(20);
        expect(worstZ).toBeLessThanOrEqual(0.02);
        const fp = gridFootprintBounds(grid, 0.05);
        expect(fp).toBeTruthy();
        let worstXy = 0;
        for (const p of lifted) {
            const lx = p.x - anchor.x;
            const ly = p.y - anchor.y;
            const inside =
                lx >= fp!.minX - 0.05 &&
                lx <= fp!.maxX + 0.05 &&
                ly >= fp!.minY - 0.05 &&
                ly <= fp!.maxY + 0.05;
            if (!inside) {
                const dx = Math.max(fp!.minX - lx, 0, lx - fp!.maxX);
                const dy = Math.max(fp!.minY - ly, 0, ly - fp!.maxY);
                worstXy = Math.max(worstXy, Math.hypot(dx, dy));
            }
        }
        console.log("MET-PAD-ENVELOPE-XY", { worstXy, lifted: lifted.length });
        expect(worstXy).toBeLessThanOrEqual(0.05);
        writeRender("met-pad-before.png", plain);
        writeRender("met-pad-after.png", composed);
        plain.dispose();
        composed.dispose();
        raw.dispose();
    }, 90_000);

    test("230 and 290 — footprint scales by L/260 within 1%, peak stays 5.0±0.02", async () => {
        const native = await loadSampleTop("right");
        const nativeFrame = getBaseFootprintFrame(native, "right");
        const sidecarU = 0.5473;
        const ref260 = scaleGeometryToInsoleSize(
            native,
            260,
            nativeFrame.widSize * (260 / nativeFrame.lenSize),
        );
        const wRef = localWidthAtU(ref260, "right", sidecarU);
        const results: { size: number; along: number; across: number; peak: number }[] = [];
        for (const L of [230, 260, 290]) {
            const W = nativeFrame.widSize * (L / nativeFrame.lenSize);
            const sized = scaleGeometryToInsoleSize(native, L, W);
            const el = await defaultMetPad(sized, "right", "noFlow");
            const field = fieldWith(sized, "right", el);
            const size = elementSizeScale(
                sized,
                "right",
                (await resolvePlacedAssetContexts([el], "right", 1, 1, sized))[0]!.sidecar,
                ref260,
            );
            const plain = applyBaseModifiers(sized, { ...field, includeElements: false, elements: [] }, 0);
            const composed = plain.clone();
            await applyElementsToTopMeshLast(composed, sized, field, { subdivide: false });
            const ctx = await resolvePlacedAssetContexts(
                [el],
                "right",
                field.lengthMm,
                field.widthMm,
                sized,
                ref260,
            );
            const { grid } = await loadTransformedAssetPositions(ctx[0]!.assetId, ctx[0]!.transform);
            const fp = gridFootprintBounds(grid, 0.05)!;
            const along = (fp.maxX - fp.minX) / 66.75;
            const across = (fp.maxY - fp.minY) / 55.0;
            expect(along / (L / 260)).toBeGreaterThan(0.99);
            expect(along / (L / 260)).toBeLessThan(1.01);
            expect(across / (L / 260)).toBeGreaterThan(0.99);
            expect(across / (L / 260)).toBeLessThan(1.01);
            expect(grid.maxZ).toBeGreaterThan(5 - 0.02);
            expect(grid.maxZ).toBeLessThan(5 + 0.02);
            const w = localWidthAtU(sized, "right", sidecarU);
            expect(size.rawAlong).toBeCloseTo(L / 260, 3);
            expect(size.scaleAlong).toBeCloseTo(L / 260, 3);
            expect(size.rawAcross).toBeCloseTo(w / wRef, 3);
            if (L === 260) {
                expect(size.scaleAlong).toBeCloseTo(1, 3);
                expect(size.scaleAcross).toBeCloseTo(1, 3);
            }
            results.push({ size: L, along, across, peak: grid.maxZ });
            plain.dispose();
            composed.dispose();
            sized.dispose();
        }
        console.log("MET-PAD-SIZE", results);
        ref260.dispose();
        expect(results).toHaveLength(3);
        native.dispose();
    }, 120_000);

    test("L/R mirror per vertex within 0.05 mm", async () => {
        const rawR = await loadSampleTop("right");
        const rawL = await loadSampleTop("left");
        const elR = await defaultMetPad(rawR, "right", "noFlow");
        const elL = await defaultMetPad(rawL, "left", "noFlow");
        const fieldR = fieldWith(rawR, "right", elR);
        const fieldL = fieldWith(rawL, "left", elL);
        const plainR = applyBaseModifiers(rawR, { ...fieldR, includeElements: false, elements: [] }, 0);
        const plainL = applyBaseModifiers(rawL, { ...fieldL, includeElements: false, elements: [] }, 0);
        const meshR = plainR.clone();
        const meshL = plainL.clone();
        await applyElementsToTopMeshLast(meshR, rawR, fieldR, { subdivide: false });
        await applyElementsToTopMeshLast(meshL, rawL, fieldL, { subdivide: false });
        const taR = getBaseFootprintFrame(rawR, "right").thickAxis;
        const taL = getBaseFootprintFrame(rawL, "left").thickAxis;
        const a = meshR.getAttribute("position")!.array as Float32Array;
        const b = meshL.getAttribute("position")!.array as Float32Array;
        const pa = plainR.getAttribute("position")!.array as Float32Array;
        const pb = plainL.getAttribute("position")!.array as Float32Array;
        expect(a.length).toBe(b.length);
        let worst = 0;
        let n = 0;
        for (let i = 0; i < a.length / 3; i++) {
            const liftR = a[i * 3 + taR]! - pa[i * 3 + taR]!;
            const liftL = b[i * 3 + taL]! - pb[i * 3 + taL]!;
            if (liftR < 0.05 && liftL < 0.05) continue;
            n++;
            worst = Math.max(worst, Math.abs(liftR - liftL));
        }
        console.log("MET-PAD-LR", { n, worst });
        expect(n).toBeGreaterThan(20);
        expect(worst).toBeLessThanOrEqual(0.05);
        meshR.dispose();
        meshL.dispose();
        plainR.dispose();
        plainL.dispose();
        rawR.dispose();
        rawL.dispose();
    }, 90_000);

    test("print loft includes the pad and hard STL gates pass", async () => {
        const raw = await loadSampleTop("right");
        const el = await defaultMetPad(raw, "right", "flow");
        const field = fieldWith(raw, "right", el);
        const plain = await composePrintSolidTop(raw, {
            sourceField: { ...field, elements: [], includeElements: false },
        });
        const withEl = await composePrintSolidTop(raw, { sourceField: field });
        const ta = getBaseFootprintFrame(raw, "right").thickAxis;
        const pa = plain.getAttribute("position")!.array as Float32Array;
        const pb = withEl.getAttribute("position")!.array as Float32Array;
        let maxRaise = 0;
        for (let i = 0; i < pa.length / 3; i++) {
            maxRaise = Math.max(maxRaise, pb[i * 3 + ta]! - pa[i * 3 + ta]!);
        }
        console.log("MET-PAD-LOFT-RAISE", { maxRaise });
        expect(maxRaise).toBeGreaterThan(2);
        const loft = await reconstructProceduralPreview(raw, {
            sourceField: field,
            composedTop: true,
            wallStyle: "straight",
            scanPattern: "full_contact",
        });
        const stl = Buffer.from(geometryToBinarySTL(loft.geometry));
        mkdirSync("/tmp/met-pad-stl", { recursive: true });
        const stlPath = "/tmp/met-pad-stl/met-pad-straight.stl";
        writeFileSync(stlPath, stl);
        const helper = resolve(process.cwd(), "tests/helpers/stl-gates.py");
        const out = execFileSync("python3", [helper, "straight", stlPath], { encoding: "utf8" });
        const gate = JSON.parse(out) as { watertight: boolean; winding: boolean; bodies: number };
        console.log("MET-PAD-STL-GATES", gate);
        expect(gate.watertight).toBe(true);
        expect(gate.winding).toBe(true);
        expect(gate.bodies).toBe(1);
        writeRender("met-pad-loft-after.png", loft.geometry);
        plain.dispose();
        withEl.dispose();
        loft.geometry.dispose();
        raw.dispose();
    }, 180_000);
});
