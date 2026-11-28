// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Read-only probe: time the Print-tab solid from SAMPLE_Top through the
// worker's reconstruct, plus the export close/validate that follows a finished
// solid. Does not change product geometry. Prints one JSON report.

import { readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { closeGlbInsoleToSolid, validateManifold } from "@/lib/geometry/mesh-close";
import {
    publishPreviewManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { manufacturingCacheContext } from "@/lib/geometry/procedural-wall/manufacturing-solid-context";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    primeSampleTopGeometry,
    reconstructProceduralPreview,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { DesignState, ElementKind, PlacedElement, Side } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const REPORT_PATH = resolve("/tmp/print-solid-benchmark.last.json");

interface CpuNode {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
    hitCount: number;
    children?: number[];
}

interface CpuProfile {
    nodes: CpuNode[];
    samples: number[];
    timeDeltas: number[];
}

function fileBase(url: string): string {
    const clean = url.split("?")[0] ?? url;
    const parts = clean.split("/");
    return parts[parts.length - 1] || clean;
}

function stageOf(fn: string): string {
    if (
        /composePrintSolid|applyBaseModifiers|applyElements|applyProcedural|clipPrint|clipGeometry|applyShoeWidth|subdivideLongEdges|loadTransformed|getOrRasterize/.test(
            fn,
        )
    ) {
        return "top-mesh compose (modifiers, elements, trim)";
    }
    if (/extractTop|buildUvField|followWallToPlantar|nearestInHash|buildFaired|syntheticBottom/.test(fn)) {
        return "top-sheet extract / rim";
    }
    if (
        /countPlanViewChordCrossings|limitPairingSkew|pairAtNative|buildHermite|evenSplit|hygieneBottom|constraintTargets|nearestOnLoop|limitStationSkew|stampMonotonic|reparameterize/.test(
            fn,
        )
    ) {
        return "stations / pattern pairing";
    }
    if (
        /libraryCdt|hexSteiner|maxBoundary|minDistToLoop|cdtDisk|triangulatePlantar|collarSteiner|inwardEdgeSteiner|buildGeneratedPlantar|nudgeInterior|sliverFill/.test(
            fn,
        )
    ) {
        return "plantar cap (CDT)";
    }
    if (
        /curveST|densifyPolyline|polylineArc|sampleSweep|columnPoints|buildBezier|applySpline|guardFrames|applyAla|initColumn|sampleArc|constructFillet|constructSweep|columnProfile|fairRound|choosePiece|applySmooth/.test(
            fn,
        )
    ) {
        return "wall loft / fillet / spline";
    }
    if (/hypot3|dist3|vecAngle|Math\.hypot/.test(fn)) return "vector math (shared leaves)";
    if (
        /analyzeManifold|validateManifold|buildEdgeUsage|windingReport|flippedWall|sanitizeMesh|countOpenNonBoundary|faceEdgeSet|countJunction|assertGenerated/.test(
            fn,
        )
    ) {
        return "validation / watertight";
    }
    if (/computeVertexNormals|computeBounding/.test(fn)) return "normals / bounds";
    if (/stringify/.test(fn)) return "debug logging";
    if (fn === "(garbage collector)") return "garbage collection";
    return "other";
}

function summarizeProfile(profile: CpuProfile) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const selfUs = new Map<number, number>();
    for (let i = 0; i < profile.samples.length; i++) {
        const id = profile.samples[i] ?? 0;
        const dt = profile.timeDeltas[i] ?? 0;
        selfUs.set(id, (selfUs.get(id) ?? 0) + dt);
    }
    const inclusive = new Map<number, number>();
    const visiting = new Set<number>();
    const incl = (id: number): number => {
        const cached = inclusive.get(id);
        if (cached != null) return cached;
        if (visiting.has(id)) return selfUs.get(id) ?? 0;
        visiting.add(id);
        const node = byId.get(id);
        let total = selfUs.get(id) ?? 0;
        for (const child of node?.children ?? []) total += incl(child);
        visiting.delete(id);
        inclusive.set(id, total);
        return total;
    };
    for (const node of profile.nodes) incl(node.id);

    const fnSelf = new Map<string, { selfUs: number; fn: string }>();
    const fnIncl = new Map<string, number>();
    for (const node of profile.nodes) {
        const fn = node.callFrame.functionName || "(anonymous)";
        const us = selfUs.get(node.id) ?? 0;
        if (us > 0) {
            const row = fnSelf.get(fn) ?? { selfUs: 0, fn };
            row.selfUs += us;
            fnSelf.set(fn, row);
        }
        const inc = inclusive.get(node.id) ?? 0;
        fnIncl.set(fn, Math.max(fnIncl.get(fn) ?? 0, inc));
    }
    const top = [...fnSelf.values()]
        .sort((a, b) => b.selfUs - a.selfUs)
        .slice(0, 25)
        .map((row) => ({
            fn: row.fn,
            selfMs: Math.round(row.selfUs / 1000),
            maxInclusiveMs: Math.round((fnIncl.get(row.fn) ?? 0) / 1000),
            stage: stageOf(row.fn),
        }));
    const topInclusive = [...fnIncl.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([fn, us]) => ({
            fn,
            maxInclusiveMs: Math.round(us / 1000),
            stage: stageOf(fn),
        }));

    const stageUs = new Map<string, number>();
    let sampledUs = 0;
    for (const row of fnSelf.values()) {
        sampledUs += row.selfUs;
        const stage = stageOf(row.fn);
        stageUs.set(stage, (stageUs.get(stage) ?? 0) + row.selfUs);
    }
    const stages = [...stageUs.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([stage, us]) => ({
            stage,
            selfMs: Math.round(us / 1000),
            pct: sampledUs > 0 ? Math.round((1000 * us) / sampledUs) / 10 : 0,
        }));

    const hottest = [...byId.values()].sort(
        (a, b) => (inclusive.get(b.id) ?? 0) - (inclusive.get(a.id) ?? 0),
    )[0];
    return {
        sampleCount: profile.samples.length,
        sampledMs: Math.round(sampledUs / 1000),
        stages,
        topSelf: top,
        topInclusive,
        hottestInclusive: hottest
            ? {
                  fn: hottest.callFrame.functionName || "(anonymous)",
                  file: fileBase(hottest.callFrame.url),
                  inclusiveMs: Math.round((inclusive.get(hottest.id) ?? 0) / 1000),
              }
            : null,
    };
}

async function profileCall<T>(
    fn: () => Promise<T>,
): Promise<{ value: T; profile: ReturnType<typeof summarizeProfile> }> {
    const session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 200 });
    await session.post("Profiler.start");
    try {
        const value = await fn();
        const { profile } = await session.post("Profiler.stop");
        return { value, profile: summarizeProfile(profile as unknown as CpuProfile) };
    } finally {
        session.disconnect();
    }
}

function meshStats(geo: BufferGeometry) {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    const ud = geo.userData as {
        loftN?: number;
        nRows?: number;
        topVertexCount?: number;
        stationCount?: number;
    };
    return {
        vertices: pos?.count ?? 0,
        triangles: index ? index.count / 3 : (pos?.count ?? 0) / 3,
        loftN: ud.loftN ?? ud.stationCount ?? null,
        nRows: ud.nRows ?? null,
        topVertexCount: ud.topVertexCount ?? null,
    };
}

function installDesign(design: DesignState): void {
    useDesignStore.setState({
        design,
        viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "functional" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

function withHeelAndElements(base: DesignState): DesignState {
    const layout = insoleLayoutFromDesign(base);
    const place = (kind: ElementKind, side: Side): PlacedElement => ({
        id: `${kind}-${side}`,
        kind,
        side,
        ...defaultElementPose(kind, side, layout.lengthMm, layout.widthMm),
    });
    const lift = 6;
    return {
        ...base,
        corrections: {
            ...base.corrections,
            left: { ...base.corrections.left, heelLiftMm: lift },
            right: { ...base.corrections.right, heelLiftMm: lift },
        },
        elements: [
            place("met_pad", "left"),
            place("mortons_extension", "left"),
            place("met_pad", "right"),
            place("mortons_extension", "right"),
        ],
    };
}

async function loadNative(): Promise<BufferGeometry> {
    const bytes = readFileSync(SAMPLE_TOP_PATH);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return sampleTopFromArrayBuffer(buf);
}

describe("print-tab solid benchmark", () => {
    test("time default SAMPLE_Top and elements+heel lift, L and R", async () => {
        resetSampleTopGeometryCache();
        resetManufacturingSolidCache();
        const native = await loadNative();
        primeSampleTopGeometry(native.clone());

        const stock = createDesignWithStockPlaceholder();
        installDesign(stock);
        const decorated = withHeelAndElements(stock);

        async function meshFor(design: DesignState, side: Side): Promise<BufferGeometry> {
            const { getDesignBase } = await import("@/lib/geometry/base-asset");
            const base = getDesignBase(design, side);
            let raw = native.clone();
            if (base?.mirrored) {
                const mirrored = mirrorGeometry(raw);
                raw.dispose();
                raw = mirrored;
            }
            return raw;
        }

        async function optionsFor(design: DesignState, side: Side, wallStyle?: "round" | "straight") {
            const thickness = design.paired
                ? side === "left"
                    ? design.paired.leftThicknessMm
                    : design.paired.rightThicknessMm
                : design.thicknessMm;
            const field = baseModifierField(design, side, thickness);
            const viewer = {
                ...(useDesignStore.getState().viewer ?? {}),
                ...(wallStyle ? { wallStyle } : {}),
            };
            return printSolidOptions({
                design,
                side,
                field,
                viewer,
                trimline: null,
                bottomPattern: null,
            });
        }

        async function timePreview(design: DesignState, side: Side, wallStyle?: "round" | "straight") {
            const raw = await meshFor(design, side);
            const options = await optionsFor(design, side, wallStyle);
            const t0 = performance.now();
            const preview = await reconstructProceduralPreview(raw, options);
            const loftMs = performance.now() - t0;
            const stats = meshStats(preview.geometry);
            const t1 = performance.now();
            const closed = closeGlbInsoleToSolid(preview.geometry);
            const closeMs = performance.now() - t1;
            const t2 = performance.now();
            const report = validateManifold(closed);
            const validateMs = performance.now() - t2;
            closed.dispose();
            preview.geometry.dispose();
            raw.dispose();
            return {
                loftMs: Math.round(loftMs),
                closeMs: Math.round(closeMs),
                validateMs: Math.round(validateMs),
                watertight: report.isWatertight,
                euler: report.eulerCharacteristic,
                ...stats,
            };
        }

        async function timeCompose(design: DesignState, side: Side) {
            const raw = await meshFor(design, side);
            const options = await optionsFor(design, side);
            const t0 = performance.now();
            const sourceField = options.sourceField;
            if (!sourceField) throw new Error("print solid benchmark: missing source field");
            const composed = await composePrintSolidTop(raw, {
                sourceField,
                shoeWidth: options.shoeWidth,
                trimline: options.trimline,
            });
            const ms = performance.now() - t0;
            const verts = composed.getAttribute("position")?.count ?? 0;
            composed.dispose();
            raw.dispose();
            return { composeMs: Math.round(ms), topVertices: verts };
        }

        // Warm the JIT on the default left foot, then measure.
        await timePreview(stock, "left");

        const defaultLeftCompose = await timeCompose(stock, "left");
        const profiled = await profileCall(async () => {
            const raw = await meshFor(stock, "left");
            const options = await optionsFor(stock, "left");
            const t0 = performance.now();
            const preview = await reconstructProceduralPreview(raw, options);
            const loftMs = Math.round(performance.now() - t0);
            const stats = meshStats(preview.geometry);
            preview.geometry.dispose();
            raw.dispose();
            return { loftMs, ...stats };
        });
        const defaultLeftLoft = profiled.value;
        const defaultLeftRest = await timePreview(stock, "left");
        const defaultLeft = { ...defaultLeftRest, loftMs: defaultLeftLoft.loftMs };
        const defaultRight = await timePreview(stock, "right");
        const elementsLeftCompose = await timeCompose(decorated, "left");
        const elementsLeft = await timePreview(decorated, "left");
        const elementsRight = await timePreview(decorated, "right");
        const straightLeft = await timePreview(stock, "left", "straight");

        installDesign(stock);
        const design = useDesignStore.getState().design;
        const solidOptions = await optionsFor(design, "left");
        const { getDesignBase } = await import("@/lib/geometry/base-asset");
        const base = getDesignBase(design, "left");
        const cache = manufacturingCacheContext({
            design,
            side: "left",
            baseAssetId: base?.assetId ?? "sample-top",
            mirrored: Boolean(base?.mirrored),
        });
        resetManufacturingSolidCache();
        const coldExportT0 = performance.now();
        const cold = await buildProceduralExportSolid(solidOptions, cache);
        const coldExportMs = Math.round(performance.now() - coldExportT0);
        publishPreviewManufacturingSolid(solidOptions, cache, cold.geometry);
        const warmT0 = performance.now();
        const warm = await buildProceduralExportSolid(solidOptions, cache);
        const warmExportMs = Math.round(performance.now() - warmT0);
        const warmHit = warm.geometry.userData.fromManufacturingCache === true;
        cold.geometry.dispose();
        warm.geometry.dispose();

        const pairDefaultMs = defaultLeft.loftMs + defaultRight.loftMs;
        const pairElementsMs = elementsLeft.loftMs + elementsRight.loftMs;
        const report = {
            note: "Print tab lofts each visible foot serially in one worker. Both feet are on by default. closeMs/validateMs are the export watertight pass, not the viewer loft. CPU profile is one default-left round-wall loft only (close and validate are outside the profile).",
            host: {
                node: process.version,
                cpus: cpus().length,
                cpuModel: cpus()[0]?.model ?? "",
                totalMemMb: Math.round(totalmem() / (1024 * 1024)),
            },
            design: {
                pattern: stock.pattern,
                usMenSize: stock.usMenSize,
                shoeWidth: stock.shoeWidth,
                thicknessMm: stock.thicknessMm,
                shellThicknessMode: stock.shellThicknessMode,
                wallStyle: "round",
                elementsCase: "met_pad + mortons_extension, heelLiftMm 6, both feet",
            },
            ms: {
                defaultLeftCompose: defaultLeftCompose.composeMs,
                defaultLeftLoft: defaultLeft.loftMs,
                defaultLeftClose: defaultLeft.closeMs,
                defaultLeftValidate: defaultLeft.validateMs,
                defaultRightLoft: defaultRight.loftMs,
                defaultPairSerial: pairDefaultMs,
                elementsLeftCompose: elementsLeftCompose.composeMs,
                elementsLeftLoft: elementsLeft.loftMs,
                elementsRightLoft: elementsRight.loftMs,
                elementsPairSerial: pairElementsMs,
                straightLeftLoft: straightLeft.loftMs,
                exportLoftCold: coldExportMs,
                exportLoftWarmCache: warmExportMs,
            },
            meshes: {
                defaultLeft: defaultLeft,
                defaultRight: defaultRight,
                elementsLeft: elementsLeft,
                elementsRight: elementsRight,
                straightLeft: straightLeft,
                defaultLeftCompose,
                elementsLeftCompose,
            },
            warmCacheHit: warmHit,
            cpu: profiled.profile,
            measuredAt: new Date().toISOString(),
        };

        writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
        // eslint-disable-next-line no-console
        console.log(`\n=== ORTHOCAD_PRINT_SOLID_BENCHMARK ===\n${JSON.stringify(report, null, 2)}`);
        expect(defaultLeft.loftMs).toBeGreaterThan(0);
        expect(defaultLeft.vertices).toBeGreaterThan(1000);
        expect(warmHit).toBe(true);
    }, 900_000);
});
