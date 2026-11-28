// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Times everything after a SAMPLE_Top solid exists: binary STL, leader, stamp,
// gzip/zstd, the server mesh gate, handedness scan, and a loopback put/get.
// VertexSlice is not called. Solid loft time is recorded only so the local
// end-to-end number has a denominator.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { gunzipSync, gzipSync, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { buildManufacturingUploadBody } from "@/features/exports/manufacturing-stl-upload";
import { stampSingleFootStl } from "@/features/exports/printer-foot-isolation";
import { defaultElementPose } from "@/lib/geometry/elements";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { applySacrificialLeaderBlock, binaryStlTriangleCount } from "@/lib/geometry/leader-block";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import { detectGcodeFoot } from "../../vertex/server/src/lib/gcode-handedness";
import { prepareManufacturingMeshForSlice, sliceMeshStats } from "../../vertex/server/src/lib/slice-mesh";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FIXTURE_GCODE = resolve(process.cwd(), "tests/fixtures/handedness/true_left_toe_first.gcode.gz");
const OUT_JSON = resolve(process.cwd(), "scripts/perf/upload-slice-benchmark.last.json");

function median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function timeMedian(fn: () => Promise<void> | void, reps = 5): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < 1 + reps; i++) {
        const t0 = performance.now();
        await fn();
        if (i >= 1) samples.push(performance.now() - t0);
    }
    return median(samples);
}

function installDesign(extra?: Partial<DesignState>): DesignState {
    const base = createDesignWithStockPlaceholder();
    const design = { ...base, method: "printing_solid" as const, ...extra };
    useDesignStore.setState({
        design,
        viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "desktop" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
    return design;
}

function mortonsElements(design: DesignState): PlacedElement[] {
    const layout = insoleLayoutFromDesign(design);
    return (["left", "right"] as const).map((side) => {
        const pose = defaultElementPose("mortons_extension", side, layout.lengthMm, layout.widthMm);
        return {
            id: `mortons-${side}`,
            kind: "mortons_extension" as const,
            side,
            ...pose,
        };
    });
}

async function exportFoot(side: Side): Promise<{ ms: number; stl: ArrayBuffer }> {
    const t0 = performance.now();
    const stl = await buildExportStl(side, { exportMode: "manufacturing", beltPrint: true });
    return { ms: performance.now() - t0, stl };
}

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** Node HTTP, not fetch: the SAMPLE_Top mock replaces global fetch for the loft. */
async function loopbackRoundTrip(body: Uint8Array): Promise<number> {
    const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk as Buffer));
        req.on("end", () => {
            res.writeHead(200, { "Content-Type": "application/octet-stream" });
            res.end(Buffer.concat(chunks));
        });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
    try {
        const port = (server.address() as AddressInfo).port;
        const t0 = performance.now();
        const back = await new Promise<Buffer>((resolveReq, rejectReq) => {
            const req = httpRequest(
                {
                    hostname: "127.0.0.1",
                    port,
                    path: "/blob",
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/octet-stream",
                        "Content-Length": body.byteLength,
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (chunk) => chunks.push(chunk as Buffer));
                    res.on("end", () => resolveReq(Buffer.concat(chunks)));
                },
            );
            req.on("error", rejectReq);
            req.end(body);
        });
        const ms = performance.now() - t0;
        if (back.byteLength !== body.byteLength) throw new Error("loopback length mismatch");
        return ms;
    } finally {
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
}

describe("upload-slice benchmark (SAMPLE_Top, post-solid)", () => {
    const glb = readFileSync(SAMPLE_TOP_PATH);

    beforeEach(() => {
        resetSampleTopGeometryCache();
        resetManufacturingSolidCache();
        globalThis.fetch = (async () =>
            new Response(glb, {
                status: 200,
                headers: { "Content-Type": "model/gltf-binary" },
            })) as typeof fetch;
    });

    afterEach(() => {
        resetSampleTopGeometryCache();
        resetManufacturingSolidCache();
    });

    test("default L+R and Morton's L+R", async () => {
        installDesign();
        const left = await exportFoot("left");
        const right = await exportFoot("right");

        resetManufacturingSolidCache();
        resetSampleTopGeometryCache();
        const parallelStart = performance.now();
        const parallel = await Promise.all([exportFoot("left"), exportFoot("right")]);
        const parallelWallMs = performance.now() - parallelStart;

        resetManufacturingSolidCache();
        resetSampleTopGeometryCache();
        const withElements = installDesign();
        installDesign({ ...withElements, elements: mortonsElements(withElements) });
        const mortonsLeft = await exportFoot("left");
        const mortonsRight = await exportFoot("right");

        const solid = left.stl;
        const leaderMs = await timeMedian(() => {
            applySacrificialLeaderBlock(solid.slice(0));
        });
        const withLeader = applySacrificialLeaderBlock(solid.slice(0));
        const stampMs = await timeMedian(() => {
            stampSingleFootStl(withLeader.slice(0), "left");
        });
        const stamped = stampSingleFootStl(withLeader, "left");
        const stampedBytes = new Uint8Array(stamped);

        const gzipMs = await timeMedian(() => {
            gzipSync(stampedBytes);
        });
        const gzipped = gzipSync(stampedBytes);
        const gunzipMs = await timeMedian(() => {
            gunzipSync(gzipped);
        });
        const zstdMs = await timeMedian(() => {
            zstdCompressSync(stampedBytes);
        });
        const zstd = zstdCompressSync(stampedBytes);
        const zstdDecompressMs = await timeMedian(() => {
            zstdDecompressSync(zstd);
        });

        const uploadBodyMs = await timeMedian(async () => {
            await buildManufacturingUploadBody(stamped.slice(0));
        });
        const uploadBody = await buildManufacturingUploadBody(stamped.slice(0));

        const meshGateMs = await timeMedian(() => {
            prepareManufacturingMeshForSlice(stampedBytes);
        });
        const meshStats = sliceMeshStats(stampedBytes);
        const prepared = prepareManufacturingMeshForSlice(stampedBytes);

        const fixture = gunzipSync(readFileSync(FIXTURE_GCODE)).toString("utf8");
        const handednessFixtureMs = await timeMedian(() => {
            detectGcodeFoot(fixture);
        });
        const scaled = fixture
            .repeat(Math.ceil((8 * 1024 * 1024) / fixture.length))
            .slice(0, 8 * 1024 * 1024);
        const handedness8MbMs = await timeMedian(() => {
            detectGcodeFoot(scaled);
        }, 3);

        const loopbackStlMs = await timeMedian(async () => {
            await loopbackRoundTrip(gzipped);
        }, 3);
        const syntheticGcode = new Uint8Array(8 * 1024 * 1024);
        syntheticGcode.fill(71);
        const loopbackGcodeMs = await timeMedian(async () => {
            await loopbackRoundTrip(syntheticGcode);
        }, 3);

        const report = {
            fixture: "SAMPLE_Top.glb",
            note: "VertexSlice was not called. Solid time is context. Post-solid stages are the measurement.",
            host: { node: process.version, platform: process.platform, worker: typeof Worker },
            measuredAt: new Date().toISOString(),
            default: {
                leftMs: Math.round(left.ms),
                rightMs: Math.round(right.ms),
                sequentialPairMs: Math.round(left.ms + right.ms),
                parallelPairMs: Math.round(parallelWallMs),
                parallelLeftMs: Math.round(parallel[0].ms),
                parallelRightMs: Math.round(parallel[1].ms),
                leftTriangles: binaryStlTriangleCount(left.stl),
                rightTriangles: binaryStlTriangleCount(right.stl),
                leftBytes: left.stl.byteLength,
                rightBytes: right.stl.byteLength,
            },
            mortonsExtension: {
                heightMm: 3,
                leftMs: Math.round(mortonsLeft.ms),
                rightMs: Math.round(mortonsRight.ms),
                sequentialPairMs: Math.round(mortonsLeft.ms + mortonsRight.ms),
                leftTriangles: binaryStlTriangleCount(mortonsLeft.stl),
                rightTriangles: binaryStlTriangleCount(mortonsRight.stl),
                leftBytes: mortonsLeft.stl.byteLength,
                rightBytes: mortonsRight.stl.byteLength,
            },
            postSolidMedianMs: {
                leaderAppend: Math.round(leaderMs),
                headerStamp: Math.round(stampMs * 1000) / 1000,
                gzip: Math.round(gzipMs),
                gunzip: Math.round(gunzipMs),
                zstd: Math.round(zstdMs),
                zstdDecompress: Math.round(zstdDecompressMs),
                clientUploadBody: Math.round(uploadBodyMs),
                serverMeshGate: Math.round(meshGateMs),
                handednessCompactFixture: Math.round(handednessFixtureMs * 100) / 100,
                handednessScaled8Mb: Math.round(handedness8MbMs),
                loopbackGzipStl: Math.round(loopbackStlMs),
                loopback8MbGcode: Math.round(loopbackGcodeMs),
            },
            bytes: {
                solid: solid.byteLength,
                withLeader: withLeader.byteLength,
                gzip: gzipped.byteLength,
                zstd: zstd.byteLength,
                uploadBody: uploadBody.body.byteLength,
                uploadCompressed: uploadBody.compressed,
                uploadEncoding: uploadBody.contentEncoding ?? null,
                meshGateRewrote: prepared.byteLength !== stampedBytes.byteLength,
                meshTriangles: meshStats.triangles,
                fixtureGcodeChars: fixture.length,
                sha256: sha256(stampedBytes),
            },
        };

        writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
        console.log(`\n=== ORTHOCAD_UPLOAD_SLICE_BENCHMARK ===\n${JSON.stringify(report, null, 2)}`);

        expect(report.default.leftTriangles).toBeGreaterThan(1000);
        expect(report.bytes.withLeader).toBeGreaterThan(report.bytes.solid);
        expect(report.mortonsExtension.leftTriangles).toBeGreaterThan(1000);
        expect(report.bytes.gzip).toBeLessThan(report.bytes.withLeader);
    });
});
