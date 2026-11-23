// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";

import { afterEach, describe, expect, test } from "@rstest/core";
import { buildRegional3mfFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { buildVertexSliceModel } from "@/features/exports/vertexslice-regional-model";
import { buildSavedDesignSnapshot } from "@/lib/clinical/saved-design-snapshot";
import { ELEMENT_PROFILES, elementHeightAt } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { defaultDesign } from "@/stores/design-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import { sliceWithVertexSlice } from "../../../server/src/lib/vertexslice-client";
import { DESIGN_SETTINGS_SCHEMA_VERSION } from "../../../shared/design-settings";
import { classFingerprint, HARDNESS_CLASS_TABLE } from "../../../shared/print-recipe/hardness-class-table";
import {
    DEFAULT_ELEMENT_DEPTH,
    DEFAULT_ELEMENT_PRIORITY,
} from "../../../shared/print-recipe/hardness-region";
import { gyroidInfillPctForHardness } from "../../../shared/print-recipe/print-recipe";
import { parseSavedDesignCatalog, type StoredLinkShoe } from "../../../shared/saved-design-catalog";
import { selectVertexSliceUpload } from "../../../shared/vertexslice-regional-3mf";
import { collectHardnessRegions, effectiveHardnessRegions, elementToRegion } from "./collect";
import { readPackedHardness3mf } from "./export-3mf";
import { bboxOf, GRID_MM } from "./mesh";
import { samplerForDesign } from "./pipeline";
import { buildElementFootprint } from "./prism";

const ORIGINAL_FETCH = globalThis.fetch;
const STORED_NINE: StoredLinkShoe = {
    system: "US_M",
    size: 9,
    left: null,
    right: null,
    width: null,
};

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.VERTEXSLICE_SLICER_URL;
    delete process.env.VERTEXSLICE_API_KEY;
});

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function savedDesign(catalog: unknown): DesignState {
    const built = buildSavedDesignSnapshot({
        stored: STORED_NINE,
        catalog: parseSavedDesignCatalog(catalog),
    });
    return built.design;
}

function settingsEnvelope(design: DesignState): { schemaVersion: number; settings: DesignState } {
    return { schemaVersion: DESIGN_SETTINGS_SCHEMA_VERSION, settings: design };
}

/** Closed box. The modifier lives in the design frame; the shell is only the uploaded solid. */
function footStl(): ArrayBuffer {
    const x0 = 0;
    const y0 = -40;
    const z0 = 0;
    const x1 = 275;
    const y1 = 40;
    const z1 = 8;
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

function placed(
    partial: Pick<PlacedElement, "id" | "kind" | "side"> & Partial<PlacedElement>,
): PlacedElement {
    return {
        position: { x: 40, y: -8 },
        rotationDeg: 0,
        scale: { x: 1, y: 1 },
        heightMm: 3,
        ...partial,
    };
}

async function captureForm(args: {
    model: Uint8Array;
    filename: string;
    infillDensityPct: number;
    expectedRegionCount?: number;
}): Promise<{
    keys: string[];
    infill: string | null;
    profile: string | null;
    name: string;
    type: string;
    bytes: Uint8Array;
}> {
    process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
    process.env.VERTEXSLICE_API_KEY = "test-key";
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
        const headers =
            args.expectedRegionCount !== undefined
                ? { "X-VertexSlice-Regions": String(args.expectedRegionCount) }
                : undefined;
        return new Response("G1 X0\n", { status: 200, headers });
    }) as typeof fetch;
    try {
        await sliceWithVertexSlice({
            profileId: "apex-v2-insole-95a",
            material: "apex_core",
            model: args.model,
            filename: args.filename,
            infillDensityPct: args.infillDensityPct,
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
        profile: form.get("profile_id") as string | null,
        name: modelPart.filename,
        type: modelPart.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
    };
}

describe("Morton's extension Extra Hard default", () => {
    test("a Morton's extension with no hardnessClass resolves to Extra Hard in collectHardnessRegions", () => {
        const extra = HARDNESS_CLASS_TABLE["Extra Hard"];
        expect(ELEMENT_PROFILES.mortons_extension.defaultHardnessClass).toBe("Extra Hard");
        expect(extra.sparseInfillDensityPct).toBe(38);
        expect(extra.sparseInfillPattern).toBe("gyroid");
        expect(extra.sparseInfillLineWidthMm).toBe(1);

        const design = savedDesign({
            elements: [{ name: "Morton's Ext.", side: "left" }],
        });
        const el = design.elements[0];
        if (!el) throw new Error("missing Morton's element");
        expect(el.kind).toBe("mortons_extension");
        expect(el.hardnessClass).toBeUndefined();
        expect(design.splitElements).not.toBe(true);

        const regions = collectHardnessRegions(design, "left");
        expect(regions).toHaveLength(1);
        const region = regions[0];
        if (!region) throw new Error("missing hardness region");
        expect(region).toEqual({
            regionId: el.id,
            kind: "element",
            hardnessClass: "Extra Hard",
            priority: DEFAULT_ELEMENT_PRIORITY,
            depth: { ...DEFAULT_ELEMENT_DEPTH },
            side: "left",
            elementId: el.id,
            label: "mortons_extension",
        });
        const finger = classFingerprint(region.hardnessClass);
        expect(finger).toEqual(classFingerprint("Extra Hard"));
        expect(finger.densityPct).toBe(extra.sparseInfillDensityPct);
        expect(finger.lineWidthMm).toBe(extra.sparseInfillLineWidthMm);
        expect(finger.densityPct).toBe(38);
        expect(finger.lineWidthMm).toBe(1);

        const effective = effectiveHardnessRegions(design, "left");
        expect(effective.map((item) => item.hardnessClass)).toEqual(["Extra Hard"]);

        const explicit = savedDesign({
            elements: [{ name: "Morton's Ext.", side: "left" }],
        });
        const explicitEl = explicit.elements[0];
        if (!explicitEl) throw new Error("missing Morton's element");
        explicitEl.hardnessClass = "Soft";
        expect(elementToRegion(explicitEl)?.hardnessClass).toBe("Soft");
        expect(collectHardnessRegions(explicit, "left")[0]?.hardnessClass).toBe("Soft");
        explicit.splitElements = false;
        expect(effectiveHardnessRegions(explicit, "left")).toEqual([]);
        explicit.splitElements = true;
        expect(effectiveHardnessRegions(explicit, "left")[0]?.hardnessClass).toBe("Soft");

        const met = savedDesign({ elements: [{ name: "Met Pad", side: "left" }] });
        expect(met.elements[0]?.hardnessClass).toBeUndefined();
        expect(collectHardnessRegions(met, "left")).toEqual([]);
        expect(effectiveHardnessRegions(met, "left")).toEqual([]);

        const reverse = savedDesign({ elements: [{ name: "Rev. Morton's", side: "right" }] });
        expect(collectHardnessRegions(reverse, "right")).toEqual([]);
    });

    test("the production slice request carries a 38% modifier on the Morton's footprint only", async () => {
        const design = savedDesign({
            elements: [{ name: "Morton's Ext.", side: "left" }],
        });
        const el = design.elements[0];
        if (!el) throw new Error("missing Morton's element");
        const stl = footStl();
        const regional = await buildRegional3mfFromSavedSettings({
            settingsJson: settingsEnvelope(design),
            side: "left",
            manufacturingStl: stl,
        });
        if (!regional) throw new Error("production path returned no regional 3MF");
        expect(regional.regionCount).toBe(1);

        const upload = selectVertexSliceUpload({
            stl: new Uint8Array(stl),
            stlFilename: "left.stl",
            regional3mf: regional,
            regional3mfEnabled: true,
        });
        expect(upload.filename).toBe("model.3mf");
        expect(upload.contentType).toBe("model/3mf");
        expect(upload.expectedRegionCount).toBe(1);
        expect(upload.bytes).toEqual(regional.bytes);

        const packed = await readPackedHardness3mf(upload.bytes);
        expect(packed.modifiers).toHaveLength(1);
        const part = packed.modifiers[0];
        if (!part) throw new Error("missing modifier");
        const extra = HARDNESS_CLASS_TABLE["Extra Hard"];
        expect(part.hardnessClass).toBe("Extra Hard");
        expect(part.density).toBe(`${extra.sparseInfillDensityPct}%`);
        expect(part.density).toBe("38%");
        expect(part.pattern).toBe("gyroid");
        expect(part.lineWidth).toBe(extra.sparseInfillLineWidthMm.toFixed(1));
        expect(part.lineWidth).toBe("1.0");
        expect(part.speed).toBe(extra.sparseInfillSpeedMmS.toFixed(1));

        const layout = insoleLayoutFromDesign(design);
        const sampler = samplerForDesign(design, "left", el.id);
        const footprint = buildElementFootprint(el, sampler);
        if (!footprint || footprint.length < 3) throw new Error("Morton's footprint missing");
        let footMinX = Infinity;
        let footMaxX = -Infinity;
        let footMinY = Infinity;
        let footMaxY = -Infinity;
        for (const point of footprint) {
            footMinX = Math.min(footMinX, point.x);
            footMaxX = Math.max(footMaxX, point.x);
            footMinY = Math.min(footMinY, point.y);
            footMaxY = Math.max(footMaxY, point.y);
        }
        const box = bboxOf(part.mesh);
        const tol = GRID_MM * 8;
        expect(box.min[0]).toBeGreaterThanOrEqual(footMinX - tol);
        expect(box.max[0]).toBeLessThanOrEqual(footMaxX + tol);
        expect(box.min[1]).toBeGreaterThanOrEqual(footMinY - tol);
        expect(box.max[1]).toBeLessThanOrEqual(footMaxY + tol);
        expect(box.max[0] - box.min[0]).toBeLessThan(layout.lengthMm * 0.6);
        expect(box.max[1] - box.min[1]).toBeLessThan(layout.widthMm * 0.6);

        const heelX = 12;
        expect(elementHeightAt([el], heelX, 0, layout.lengthMm, layout.widthMm)).toBe(0);
        expect(heelX).toBeLessThan(box.min[0]);
        expect(box.min[0]).toBeGreaterThan(layout.lengthMm * 0.5);

        expect(box.min[1]).toBeGreaterThan(0);
        expect(box.max[1]).toBeLessThan(layout.widthMm / 2);
        let covered = false;
        for (let u = 0.7; u <= 0.95; u += 0.05) {
            const x = u * layout.lengthMm;
            for (let y = 2; y < layout.widthMm / 2; y += 2) {
                if (elementHeightAt([el], x, y, layout.lengthMm, layout.widthMm) < 2) continue;
                if (x < box.min[0] || x > box.max[0] || y < box.min[1] || y > box.max[1]) continue;
                covered = true;
            }
        }
        expect(covered).toBe(true);

        const devicePct = gyroidInfillPctForHardness(design.printRecipe?.defaultHardness ?? "Medium");
        expect(devicePct).toBe(26);
        const posted = await captureForm({
            model: upload.bytes,
            filename: upload.filename,
            infillDensityPct: devicePct,
            expectedRegionCount: upload.expectedRegionCount,
        });
        expect(posted.keys).toEqual(["infill_density", "material", "model", "profile_id"]);
        expect(posted.infill).toBe("26");
        expect(posted.profile).toBe("apex-v2-insole-95a");
        expect(posted.name).toBe("model.3mf");
        expect(posted.type).toBe("model/3mf");
        expect(sha256(posted.bytes)).toBe(sha256(upload.bytes));
    });

    test("SAMPLE_Top with no elements and a non-Morton element keep the STL slice request", async () => {
        const stl = footStl();
        const stlBytes = new Uint8Array(stl);
        const cases: Array<{ label: string; catalog: unknown; side: Side }> = [
            { label: "stock", catalog: {}, side: "left" },
            { label: "met-pad", catalog: { elements: [{ name: "Met Pad", side: "left" }] }, side: "left" },
        ];
        const posts = [];
        for (const item of cases) {
            const design = savedDesign(item.catalog);
            expect(design.elements.some((el) => el.kind === "mortons_extension")).toBe(false);
            expect(design.base?.name ?? design.paired?.leftBase?.name).toMatch(/SAMPLE_Top/);
            const regional = await buildRegional3mfFromSavedSettings({
                settingsJson: settingsEnvelope(design),
                side: item.side,
                manufacturingStl: stl.slice(0),
            });
            expect(regional).toBeNull();
            const upload = selectVertexSliceUpload({
                stl: stlBytes,
                stlFilename: `${item.side}.stl`,
                regional3mf: regional,
                regional3mfEnabled: true,
            });
            expect(upload.filename).toBe(`${item.side}.stl`);
            expect(upload.contentType).toBe("model/stl");
            expect(upload.expectedRegionCount).toBeUndefined();
            expect(upload.bytes).toEqual(stlBytes);
            expect(sha256(upload.bytes)).toBe(sha256(stlBytes));

            const built = await buildVertexSliceModel({
                design,
                side: item.side,
                manufacturingStl: stl.slice(0),
                stlFilename: `${item.side}.stl`,
                regional3mfEnabled: true,
            });
            expect(built.regionCount).toBe(0);
            expect(built.bytes).toEqual(stlBytes);

            const devicePct = gyroidInfillPctForHardness(design.printRecipe?.defaultHardness ?? "Medium");
            const posted = await captureForm({
                model: built.bytes,
                filename: built.filename,
                infillDensityPct: devicePct,
            });
            posts.push(posted);
            expect(posted.keys).toEqual(["infill_density", "material", "model", "profile_id"]);
            expect(posted.infill).toBe(String(devicePct));
            expect(posted.name).toBe(`${item.side}.stl`);
            expect(posted.type).toBe("model/stl");
            expect(posted.bytes).toEqual(stlBytes);
        }
        expect(posts[0]).toEqual(posts[1]);

        const explicit = savedDesign({
            elements: [{ name: "Morton's Ext.", side: "left" }],
        });
        const el = explicit.elements[0];
        if (!el) throw new Error("missing Morton's element");
        el.hardnessClass = "Hard";
        explicit.splitElements = false;
        const unchanged = await buildVertexSliceModel({
            design: explicit,
            side: "left",
            manufacturingStl: stl.slice(0),
            stlFilename: "left.stl",
            regional3mfEnabled: true,
        });
        expect(unchanged.regionCount).toBe(0);
        expect(unchanged.bytes).toEqual(stlBytes);

        explicit.splitElements = true;
        const kept = await buildVertexSliceModel({
            design: explicit,
            side: "left",
            manufacturingStl: stl.slice(0),
            stlFilename: "left.stl",
            regional3mfEnabled: true,
        });
        expect(kept.regionCount).toBe(1);
        const packed = await readPackedHardness3mf(kept.bytes);
        expect(packed.modifiers.map((part) => [part.hardnessClass, part.density, part.lineWidth])).toEqual([
            ["Hard", "32%", "1.0"],
        ]);
        const plain = defaultDesign();
        plain.elements = [
            placed({ id: "pad", kind: "met_pad", side: "left", hardnessClass: "Soft", regionId: "pad" }),
        ];
        plain.splitElements = true;
        expect(collectHardnessRegions(plain, "left")[0]?.hardnessClass).toBe("Soft");
    });
});
