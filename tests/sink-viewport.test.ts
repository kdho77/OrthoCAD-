// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    composePrintSolidTop,
    composeViewerPrintSolidTop,
} from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { SINK_KIND_ORDER, SINK_PROFILES, sinkCutAt } from "@/lib/geometry/sink";
import type { PlacedSink, SideCorrections, SinkKind } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zeroCorrections(): SideCorrections {
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

function field(sinks?: PlacedSink[]): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zeroCorrections(),
        elements: [],
        includeElements: false,
        includeSkives: false,
        trimline: null,
        ...(sinks && sinks.length > 0 ? { sinks } : {}),
    };
}

function sinkAt(kind: SinkKind, depthMm: number): PlacedSink {
    return { id: kind, kind, depthMm };
}

async function loadSampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    return sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

type ComposeFn = (raw: BufferGeometry, sourceField: HeightFieldParams) => Promise<BufferGeometry>;

const entryPoints: Record<string, ComposeFn> = {
    composePrintSolidTop: (raw, sourceField) => composePrintSolidTop(raw, { sourceField }),
    composeViewerPrintSolidTop: (raw, sourceField) => composeViewerPrintSolidTop({ raw, sourceField }),
};

/** Deepest composed vertex of each sink, and the largest plan move. */
function sinkHeightReport(
    plain: BufferGeometry,
    sunk: BufferGeometry,
    raw: BufferGeometry,
    sinks: PlacedSink[],
) {
    const frame = getBaseFootprintFrame(raw, "left");
    const ctx = field(sinks);
    const base = raw.getAttribute("position");
    const a = plain.getAttribute("position");
    const b = sunk.getAttribute("position");
    const best = new Map<string, { dz: number; weight: number }>();
    let xyMm = 0;
    const n = Math.min(a.count, b.count, base.count);
    for (let i = 0; i < n; i++) {
        const ax = a.getX(i);
        const ay = a.getY(i);
        xyMm = Math.max(xyMm, Math.hypot(b.getX(i) - ax, b.getY(i) - ay));
        const len = base.getComponent(i, frame.lengthAxis);
        const wid = base.getComponent(i, frame.widthAxis);
        const u = Math.max(0, Math.min(1, (len - frame.lenMin) / frame.lenSize));
        const vSigned = Math.max(
            -1,
            Math.min(1, (frame.widthSign * (wid - frame.widCenter)) / (frame.widSize / 2)),
        );
        const sample = sinkCutAt(u, vSigned, ctx);
        if (!sample.sinkId || sample.weight <= 0) continue;
        const dz = b.getComponent(i, frame.thickAxis) - a.getComponent(i, frame.thickAxis);
        const prev = best.get(sample.sinkId);
        if (!prev || sample.weight > prev.weight) best.set(sample.sinkId, { dz, weight: sample.weight });
    }
    return { best, xyMm, plainCount: a.count, sunkCount: b.count };
}

describe("composed viewport sink height", () => {
    test("every sink and a max 1st MPJ move the composed sheet in height only", async () => {
        const raw = await loadSampleTop();
        const six = SINK_KIND_ORDER.map((kind) => sinkAt(kind, SINK_PROFILES[kind].defaultDepthMm));
        const mpj1Max = [sinkAt("mpj1", SINK_PROFILES.mpj1.maxDepthMm)];
        for (const [name, compose] of Object.entries(entryPoints)) {
            const plain = await compose(raw, field());
            const withSix = await compose(raw, field(six));
            const withMax = await compose(raw, field(mpj1Max));
            const sixReport = sinkHeightReport(plain, withSix, raw, six);
            const maxReport = sinkHeightReport(plain, withMax, raw, mpj1Max);
            const sixDz = Object.fromEntries(
                SINK_KIND_ORDER.map((kind) => [kind, sixReport.best.get(kind) ?? null]),
            );
            console.log(
                "[SINK-VIEWPORT]",
                name,
                JSON.stringify({ sixDz, mpj1Max: maxReport.best.get("mpj1") }),
            );
            expect(sixReport.sunkCount).toBe(sixReport.plainCount);
            expect(maxReport.sunkCount).toBe(maxReport.plainCount);
            expect(sixReport.xyMm).toBeLessThan(1e-4);
            expect(maxReport.xyMm).toBeLessThan(1e-4);
            for (const kind of SINK_KIND_ORDER) {
                const hit = sixReport.best.get(kind);
                expect(hit, `${name} ${kind}`).toBeTruthy();
                expect(Math.abs(hit!.dz)).toBeGreaterThan(0.05);
            }
            const maxHit = maxReport.best.get("mpj1");
            expect(maxHit, `${name} mpj1 max`).toBeTruthy();
            expect(Math.abs(maxHit!.dz)).toBeGreaterThan(0.05);
            plain.dispose();
            withSix.dispose();
            withMax.dispose();
        }
        raw.dispose();
    }, 120_000);
});
