// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import {
    buildVertexSliceModel,
    parseRegionalCapability,
    regionalSliceDecision,
} from "@/features/exports/vertexslice-regional-model";
import { effectiveHardnessRegions } from "@/lib/hardness/collect";
import { readPackedHardness3mf } from "@/lib/hardness/export-3mf";
import { BOTTOM_CLAMP_MM, parseBinaryStl } from "@/lib/hardness/mesh";
import { defaultDesign } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import { sliceWithVertexSlice } from "../../../server/src/lib/vertexslice-client";
import type { HardnessRegion } from "../../../shared/print-recipe/hardness-region";
import { migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";
import { selectVertexSliceUpload } from "../../../shared/vertexslice-regional-3mf";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.VERTEXSLICE_SLICER_URL;
    delete process.env.VERTEXSLICE_API_KEY;
});

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

/** 275.0 mm long, one foot. Left and right differ in Y so the shells cannot be swapped. */
function footStl(side: Side): ArrayBuffer {
    const y = side === "left" ? -8 : 8;
    return writeBox(0, y, 0, 275, y + 36, 8);
}

function zone(
    id: string,
    side: Side,
    hardnessClass: HardnessRegion["hardnessClass"],
    priority: number,
    polygon: Array<{ x: number; y: number }>,
): HardnessRegion {
    return {
        regionId: id,
        kind: "zone",
        hardnessClass,
        priority,
        depth: { type: "mm", mm: 1 },
        side,
        polygon,
    };
}

/** Device hardness Medium (26%). Left met pad Soft, overlapped by higher-priority Hard. Right is Extra Soft. */
function regionalDesign(): DesignState {
    const design = defaultDesign();
    const recipe = migratePrintRecipe(design.printRecipe);
    design.printRecipe = {
        ...recipe,
        defaultHardness: "Medium",
        zones: [
            zone("met-left", "left", "Soft", 2, [
                { x: 80, y: -16 },
                { x: 150, y: -16 },
                { x: 150, y: 4 },
                { x: 80, y: 4 },
            ]),
            zone("overlap-left", "left", "Hard", 5, [
                { x: 100, y: -10 },
                { x: 125, y: -10 },
                { x: 125, y: 0 },
                { x: 100, y: 0 },
            ]),
            zone("met-right", "right", "Extra Soft", 2, [
                { x: 80, y: -4 },
                { x: 150, y: -4 },
                { x: 150, y: 16 },
                { x: 80, y: 16 },
            ]),
        ],
    };
    return design;
}

function meshesMatch(stl: ArrayBuffer, shell: { positions: Float32Array; indices: Uint32Array }): void {
    const parsed = parseBinaryStl(stl);
    expect(Array.from(shell.indices)).toEqual(Array.from(parsed.indices));
    expect(shell.positions.length).toBe(parsed.positions.length);
    for (let i = 0; i < parsed.positions.length; i++) {
        expect(Math.abs(shell.positions[i]! - parsed.positions[i]!)).toBeLessThan(1e-4);
    }
    let maxX = -Infinity;
    for (let i = 0; i < shell.positions.length; i += 3) maxX = Math.max(maxX, shell.positions[i]!);
    expect(maxX).toBe(275);
}

async function captureForm(args: {
    model: Uint8Array;
    filename: string;
    expectedRegionCount?: number;
    regionsHeader?: string;
}): Promise<{ keys: string[]; infill: string | null; name: string; type: string; bytes: Uint8Array }> {
    process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
    process.env.VERTEXSLICE_API_KEY = "super-secret-key";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const appended: Array<{ name: string; filename?: string; type: string }> = [];
    const originalAppend = FormData.prototype.append;
    FormData.prototype.append = function (
        this: FormData,
        name: string,
        value: string | Blob,
        filename?: string,
    ) {
        if (typeof value !== "string") appended.push({ name: String(name), filename, type: value.type });
        return originalAppend.call(this, name, value as Blob, filename);
    } as FormData["append"];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });
        if (url.endsWith("/v1/materials")) {
            return new Response(JSON.stringify(["apex_core"]), { status: 200 });
        }
        const headers = args.regionsHeader ? { "X-VertexSlice-Regions": args.regionsHeader } : undefined;
        return new Response("G1 X0\n", { status: 200, headers });
    }) as typeof fetch;
    try {
        await sliceWithVertexSlice({
            profileId: "apex-v2-insole-95a",
            material: "apex_core",
            model: args.model,
            filename: args.filename,
            infillDensityPct: 26,
            expectedRegionCount: args.expectedRegionCount,
        });
    } finally {
        FormData.prototype.append = originalAppend;
    }
    const form = calls.find((call) => call.url.endsWith("/v1/slice"))?.init.body as FormData;
    const file = form.get("model");
    if (!(file instanceof Blob)) throw new Error("model field missing");
    const modelPart = appended.find((part) => part.name === "model");
    if (!modelPart?.filename) throw new Error("model filename was not appended");
    return {
        keys: [...form.keys()].sort(),
        infill: form.get("infill_density") as string | null,
        name: modelPart.filename,
        type: modelPart.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
    };
}

describe("VertexSlice regional hardness request", () => {
    test("a design without regions posts the same STL request as today", async () => {
        const design = defaultDesign();
        for (const side of ["left", "right"] as const) {
            const stl = footStl(side);
            const built = await buildVertexSliceModel({
                design,
                side,
                manufacturingStl: stl,
                stlFilename: `${side}.stl`,
                regional3mfEnabled: true,
            });
            expect(built.contentType).toBe("model/stl");
            expect(built.filename).toBe(`${side}.stl`);
            expect(built.regionCount).toBe(0);
            expect(built.bytes).toEqual(new Uint8Array(stl));

            const direct = await captureForm({ model: new Uint8Array(stl), filename: `${side}.stl` });
            const viaBuilder = await captureForm({ model: built.bytes, filename: built.filename });
            expect(viaBuilder).toEqual(direct);
            expect(direct.keys).toEqual(["infill_density", "material", "model", "profile_id"]);
            expect(direct.infill).toBe("26");
            expect(direct.name).toBe(`${side}.stl`);
            expect(direct.type).toBe("model/stl");
            expect(direct.bytes).toEqual(new Uint8Array(stl));
        }
    });

    test("regional hardness is a 3MF of the same solid, and the gate off stays on the STL", async () => {
        const design = regionalDesign();
        const leftStl = footStl("left");
        const rightStl = footStl("right");

        const gatedOff = await buildVertexSliceModel({
            design,
            side: "left",
            manufacturingStl: leftStl,
            stlFilename: "left.stl",
            regional3mfEnabled: false,
        });
        expect(gatedOff.bytes).toEqual(new Uint8Array(leftStl));
        expect(gatedOff.filename).toBe("left.stl");
        expect(gatedOff.regionCount).toBe(0);
        const stlBytes = new Uint8Array(leftStl);
        const held = selectVertexSliceUpload({
            stl: stlBytes,
            stlFilename: "left.stl",
            regional3mf: { bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), regionCount: 2 },
            regional3mfEnabled: false,
        });
        expect(held.bytes).toBe(stlBytes);
        expect(held.filename).toBe("left.stl");
        expect(held.contentType).toBe("model/stl");
        expect(held.expectedRegionCount).toBeUndefined();

        const left = await buildVertexSliceModel({
            design,
            side: "left",
            manufacturingStl: leftStl,
            stlFilename: "left.stl",
            regional3mfEnabled: true,
        });
        const right = await buildVertexSliceModel({
            design,
            side: "right",
            manufacturingStl: rightStl,
            stlFilename: "right.stl",
            regional3mfEnabled: true,
        });
        expect(left.filename).toBe("model.3mf");
        expect(right.filename).toBe("model.3mf");
        expect(left.contentType).toBe("model/3mf");
        expect(right.contentType).toBe("model/3mf");
        expect(left.regionCount).toBe(2);
        expect(right.regionCount).toBe(1);
        expect(left.bytes).not.toEqual(right.bytes);

        const leftPacked = await readPackedHardness3mf(left.bytes);
        const rightPacked = await readPackedHardness3mf(right.bytes);
        meshesMatch(leftStl, leftPacked.shell);
        meshesMatch(rightStl, rightPacked.shell);
        expect(
            leftPacked.modifiers.map((part) => [
                part.hardnessClass,
                part.density,
                part.priority,
                part.pattern,
            ]),
        ).toEqual([
            ["Hard", "32%", "5", "gyroid"],
            ["Soft", "20%", "2", "gyroid"],
        ]);
        expect(leftPacked.modifiers.map((part) => [part.lineWidth, part.speed])).toEqual([
            ["1.0", "45.0"],
            ["0.7", "44.0"],
        ]);
        expect(
            rightPacked.modifiers.map((part) => [
                part.hardnessClass,
                part.density,
                part.lineWidth,
                part.speed,
            ]),
        ).toEqual([["Extra Soft", "14%", "0.7", "43.5"]]);
        for (const part of [...leftPacked.modifiers, ...rightPacked.modifiers]) {
            expect(part.depth).toContain('"type":"mm"');
            expect(part.depth).not.toContain('"type":"full"');
            let minZ = Infinity;
            for (let i = 2; i < part.mesh.positions.length; i += 3) {
                minZ = Math.min(minZ, part.mesh.positions[i]!);
            }
            expect(minZ).toBeGreaterThan(BOTTOM_CLAMP_MM + 0.2);
        }

        const posted = await captureForm({
            model: left.bytes,
            filename: left.filename,
            expectedRegionCount: left.regionCount,
            regionsHeader: String(left.regionCount),
        });
        expect(posted.keys).toEqual(["infill_density", "material", "model", "profile_id"]);
        expect(posted.infill).toBe("26");
        expect(posted.name).toBe("model.3mf");
        expect(posted.type).toBe("model/3mf");
        expect(posted.bytes).toEqual(left.bytes);

        const rightPosted = await captureForm({
            model: right.bytes,
            filename: right.filename,
            expectedRegionCount: right.regionCount,
            regionsHeader: String(right.regionCount),
        });
        expect(rightPosted.name).toBe("model.3mf");
        expect(rightPosted.bytes).toEqual(right.bytes);
        expect(rightPosted.bytes).not.toEqual(posted.bytes);
    });

    test("a region outside the five presets is refused", async () => {
        const design = regionalDesign();
        const zones = design.printRecipe?.zones ?? [];
        const met = zones.find((zone) => zone.regionId === "met-left");
        if (!met) throw new Error("missing met-left");
        met.hardnessClass = "Custom";
        met.overrides = { sparseInfillDensityPct: 22 };
        await expect(
            buildVertexSliceModel({
                design,
                side: "left",
                manufacturingStl: footStl("left"),
                stlFilename: "left.stl",
                regional3mfEnabled: true,
            }),
        ).rejects.toThrow(/not one of the presets/);
    });

    test("turning split elements off drops element modifiers and keeps zones", async () => {
        const design = defaultDesign();
        design.splitElements = true;
        const recipe = migratePrintRecipe(design.printRecipe);
        design.printRecipe = {
            ...recipe,
            defaultHardness: "Medium",
            zones: [
                zone("heel-left", "left", "Extra Soft", 1, [
                    { x: 40, y: -12 },
                    { x: 70, y: -12 },
                    { x: 70, y: 8 },
                    { x: 40, y: 8 },
                ]),
            ],
        };
        design.elements = [
            {
                id: "met-left",
                kind: "met_pad",
                side: "left",
                position: { x: 40, y: -8 },
                rotationDeg: 0,
                scale: { x: 1, y: 1 },
                heightMm: 5,
                regionId: "met-left",
                hardnessClass: "Soft",
                priority: 2,
                depth: { type: "element", depthBelowMm: 2 },
            },
        ];
        const stl = footStl("left");
        const onRegions = effectiveHardnessRegions(design, "left");
        expect(onRegions.map((region) => region.kind).sort()).toEqual(["element", "zone"]);
        const on = await buildVertexSliceModel({
            design,
            side: "left",
            manufacturingStl: stl,
            stlFilename: "left.stl",
            regional3mfEnabled: true,
        });
        const onPacked = await readPackedHardness3mf(on.bytes);
        expect(onPacked.modifiers.map((part) => part.hardnessClass).sort()).toEqual(["Extra Soft", "Soft"]);

        design.splitElements = false;
        const offRegions = effectiveHardnessRegions(design, "left");
        expect(offRegions.map((region) => region.kind)).toEqual(["zone"]);
        expect(offRegions.every((region) => region.kind !== "element")).toBe(true);
        const off = await buildVertexSliceModel({
            design,
            side: "left",
            manufacturingStl: stl,
            stlFilename: "left.stl",
            regional3mfEnabled: true,
        });
        const offPacked = await readPackedHardness3mf(off.bytes);
        expect(offPacked.modifiers.map((part) => [part.hardnessClass, part.density])).toEqual([
            ["Extra Soft", "14%"],
        ]);

        design.printRecipe = { ...design.printRecipe, zones: [] };
        const stlOnly = await buildVertexSliceModel({
            design,
            side: "left",
            manufacturingStl: stl,
            stlFilename: "left.stl",
            regional3mfEnabled: true,
        });
        expect(stlOnly.contentType).toBe("model/stl");
        expect(stlOnly.regionCount).toBe(0);
        expect(stlOnly.bytes).toEqual(new Uint8Array(stl));
        expect(effectiveHardnessRegions(design, "left")).toEqual([]);
    });

    test("a failed capability check is not an STL fallback", () => {
        expect(
            regionalSliceDecision({
                effectiveRegionCount: 0,
                capability: { state: "unknown", reason: "down" },
            }),
        ).toEqual({
            action: "stl",
        });
        expect(parseRegionalCapability({ enabled: true })).toEqual({ state: "enabled" });
        expect(parseRegionalCapability({ enabled: false })).toEqual({ state: "disabled" });
        expect(parseRegionalCapability({})).toEqual({
            state: "unknown",
            reason: "malformed capability response (missing enabled)",
        });
        expect(parseRegionalCapability("nope")).toEqual({
            state: "unknown",
            reason: "malformed capability response",
        });
        expect(
            regionalSliceDecision({ effectiveRegionCount: 2, capability: { state: "disabled" } }).action,
        ).toBe("fail");
        const unknown = regionalSliceDecision({
            effectiveRegionCount: 2,
            capability: { state: "unknown", reason: "HTTP 503" },
        });
        expect(unknown.action).toBe("fail");
        if (unknown.action === "fail") expect(unknown.message).toMatch(/could not be confirmed \(HTTP 503\)/);
        const off = regionalSliceDecision({ effectiveRegionCount: 1, capability: { state: "disabled" } });
        if (off.action === "fail") expect(off.message).toMatch(/turned off on this server/);
    });
});
