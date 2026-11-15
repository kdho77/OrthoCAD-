// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { exportClinicalPrinterGcode } from "@/features/exports/export-panel-clinical";
import {
    binaryStlBounds,
    binaryStlTriangleCount,
    manufacturingStlForExportKind,
} from "@/lib/geometry/leader-block";
import type { PrinterPreset } from "@/lib/kiri";
import { useDesignStore } from "@/stores/design-store";
import { decodeManufacturingUploadBytes } from "../../../server/src/routers/manufacturing-session";
import { generateHybridGcode } from "./export-service";
import { isolatedPrinterFootStls, readSingleFootStamp, stampSingleFootStl } from "./printer-foot-isolation";

const footSolids: {
    left: ArrayBuffer;
    right: ArrayBuffer;
    pair: ArrayBuffer;
    sides: string[];
    pairs: number;
} = {
    left: new ArrayBuffer(0),
    right: new ArrayBuffer(0),
    pair: new ArrayBuffer(0),
    sides: [],
    pairs: 0,
};

const sliceRequests: Array<{ side?: string; stlStorageKey?: string; fileName?: string }> = [];
const uploads: Array<{ url: string; bytes: Uint8Array }> = [];

rs.mock("@/lib/geometry/export-geometry", () => ({
    buildExportStl: async (side: string) => {
        footSolids.sides.push(side);
        const buf = side === "right" ? footSolids.right : footSolids.left;
        return buf.slice(0);
    },
    buildOrderPairStl: async () => {
        footSolids.pairs += 1;
        return footSolids.pair.slice(0);
    },
    buildOrderPairGeometry: async () => {
        throw new Error("paired scene geometry must not be sliced for one foot");
    },
    buildExportGlb: async () => new ArrayBuffer(0),
    exportModeFromMethod: () => "manufacturing",
    orderDownloadSides: (design: {
        base?: unknown;
        paired?: { leftBase?: unknown; rightBase?: unknown };
    }) => {
        const sides: string[] = [];
        if (design?.paired?.leftBase ?? design?.base) sides.push("left");
        if (design?.paired?.rightBase) sides.push("right");
        return sides.length > 0 ? sides : ["left"];
    },
}));

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        manufacturing: {
            prepareManufacturingStlUpload: {
                mutate: async ({ side }: { side: string }) => ({
                    uploadUrl: `https://upload.test/${side}/${footSolids.sides.length}`,
                    storageKey: `temp/${side}/${footSolids.sides.length}`,
                    token: "",
                }),
            },
            generateSolid: {
                mutate: async (input: { side?: string; stlStorageKey?: string; fileName?: string }) => {
                    sliceRequests.push({
                        side: input.side,
                        stlStorageKey: input.stlStorageKey,
                        fileName: input.fileName,
                    });
                    return {
                        ok: true,
                        gcode: `; sliced ${input.side} ${input.stlStorageKey} ${input.fileName}\n`,
                        productionId: input.side,
                        balance: 3,
                    };
                },
            },
        },
    },
}));

function writeBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ArrayBuffer {
    const v = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
    ];
    const faces = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    const buffer = new ArrayBuffer(84 + faces.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, faces.length, true);
    let offset = 84;
    for (const [a, b, c] of faces) {
        offset += 12;
        for (const i of [a, b, c]) {
            const p = v[i];
            if (!p) throw new Error("box vertex missing");
            view.setFloat32(offset, p[0] ?? 0, true);
            view.setFloat32(offset + 4, p[1] ?? 0, true);
            view.setFloat32(offset + 8, p[2] ?? 0, true);
            offset += 12;
        }
        view.setUint16(offset, 0, true);
        offset += 2;
    }
    return buffer;
}

/** Thick heel at min X, thin toe at max X. One foot. */
function singleFootStl(yShift: number): ArrayBuffer {
    const heel = writeBox(0, -30 + yShift, 0, 10, 30 + yShift, 24);
    const toe = writeBox(180, -15 + yShift, 0, 200, 15 + yShift, 4);
    return concatStls([heel, toe]);
}

function translateStlY(stl: ArrayBuffer, dy: number): ArrayBuffer {
    const copy = stl.slice(0);
    const view = new DataView(copy);
    const count = view.getUint32(80, true);
    for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12;
        for (let k = 0; k < 3; k++) {
            const yAt = base + k * 12 + 4;
            view.setFloat32(yAt, view.getFloat32(yAt, true) + dy, true);
        }
    }
    return copy;
}

function concatStls(parts: ArrayBuffer[]): ArrayBuffer {
    const counts = parts.map((part) => new DataView(part).getUint32(80, true));
    const total = counts.reduce((sum, n) => sum + n, 0);
    const out = new ArrayBuffer(84 + total * 50);
    new DataView(out).setUint32(80, total, true);
    let cursor = 84;
    for (const part of parts) {
        const bytes = new Uint8Array(part).subarray(84);
        new Uint8Array(out).set(bytes, cursor);
        cursor += bytes.length;
    }
    return out;
}

function expectedUpload(raw: ArrayBuffer, side: "left" | "right"): ArrayBuffer {
    return stampSingleFootStl(manufacturingStlForExportKind(raw, "gcode"), side);
}

const belt: PrinterPreset = {
    id: "apex-belt-v2",
    name: "Apex Belt V2",
    method: "printing_solid",
    beltAngleDeg: 45,
};

let originalFetch: typeof fetch;

beforeEach(() => {
    footSolids.left = singleFootStl(0);
    footSolids.right = singleFootStl(4);
    footSolids.pair = concatStls([footSolids.left, translateStlY(footSolids.right, 200)]);
    footSolids.sides = [];
    footSolids.pairs = 0;
    sliceRequests.length = 0;
    uploads.length = 0;
    useDesignStore.setState({
        design: { ...useDesignStore.getState().design, method: "printing_solid" },
    });
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT" && init?.body != null) {
            const raw = init.body;
            let bytes: Uint8Array;
            if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
            else if (ArrayBuffer.isView(raw))
                bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
            else if (raw instanceof Blob) bytes = new Uint8Array(await raw.arrayBuffer());
            else return new Response("bad put body", { status: 500 });
            uploads.push({ url: String(input), bytes });
            return new Response("", { status: 200 });
        }
        return new Response("missing", { status: 404 });
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("paired printer G-code isolation", () => {
    test("each slicer request is that foot's STL, not the paired aggregate twice", async () => {
        const pairSpan = binaryStlBounds(footSolids.pair).maxY - binaryStlBounds(footSolids.pair).minY;
        const design = useDesignStore.getState().design;
        const result = await exportClinicalPrinterGcode({
            side: "left",
            feet: "both",
            design,
            apexMaterialId: "ApexCore",
            includeLeaderBlock: true,
        });

        expect(result.ok).toBe(true);
        expect(footSolids.pairs).toBe(0);
        expect(footSolids.sides).toEqual(["left", "right"]);
        expect(sliceRequests.map((request) => request.side)).toEqual(["left", "right"]);
        expect(sliceRequests[0]?.fileName).toMatch(/_ApexCore_L\.gcode$/);
        expect(sliceRequests[1]?.fileName).toMatch(/_ApexCore_R\.gcode$/);
        expect(sliceRequests[0]?.fileName).not.toBe(sliceRequests[1]?.fileName);
        expect(sliceRequests[0]?.stlStorageKey).not.toBe(sliceRequests[1]?.stlStorageKey);
        expect(uploads).toHaveLength(2);

        const leftRow = uploads.find((row) => row.url.includes("/left/"));
        const rightRow = uploads.find((row) => row.url.includes("/right/"));
        const leftUpload = leftRow?.bytes;
        const rightUpload = rightRow?.bytes;
        if (!leftUpload || !rightUpload) throw new Error("missing uploads");
        const leftDecoded = decodeManufacturingUploadBytes(leftUpload);
        const rightDecoded = decodeManufacturingUploadBytes(rightUpload);
        const leftBytes = leftDecoded.buffer.slice(
            leftDecoded.byteOffset,
            leftDecoded.byteOffset + leftDecoded.byteLength,
        );
        const rightBytes = rightDecoded.buffer.slice(
            rightDecoded.byteOffset,
            rightDecoded.byteOffset + rightDecoded.byteLength,
        );
        const leftExpected = expectedUpload(footSolids.left, "left");
        const rightExpected = expectedUpload(footSolids.right, "right");
        expect(leftDecoded).toEqual(new Uint8Array(leftExpected));
        expect(rightDecoded).toEqual(new Uint8Array(rightExpected));
        expect(binaryStlTriangleCount(leftBytes)).toBe(binaryStlTriangleCount(leftExpected));
        expect(binaryStlTriangleCount(footSolids.pair)).toBe(
            binaryStlTriangleCount(footSolids.left) + binaryStlTriangleCount(footSolids.right),
        );
        expect(new Uint8Array(leftBytes)).not.toEqual(new Uint8Array(footSolids.pair));
        expect(new Uint8Array(rightBytes)).not.toEqual(new Uint8Array(footSolids.pair));
        expect(readSingleFootStamp(leftBytes)).toBe("left");
        expect(readSingleFootStamp(rightBytes)).toBe("right");
        const isolated = isolatedPrinterFootStls(leftBytes, rightBytes, pairSpan);
        expect(isolated.ok).toBe(true);
        expect(leftRow?.url).toContain("/left/");
        expect(rightRow?.url).toContain("/right/");

        const rightOnly = await generateHybridGcode(
            "right",
            belt,
            { type: "rounded", radius_mm: 3 },
            {},
            {
                apexMaterialId: "ApexCore",
                includeLeaderBlock: true,
                deferDownload: true,
            },
        );
        expect(rightOnly.ok).toBe(true);
        expect(footSolids.sides.at(-1)).toBe("right");
        expect(footSolids.pairs).toBe(0);
        expect(sliceRequests.at(-1)?.side).toBe("right");
        expect(sliceRequests.at(-1)?.fileName).toMatch(/_ApexCore_R\.gcode$/);
    });
});
