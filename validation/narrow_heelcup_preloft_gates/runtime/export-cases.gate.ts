import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "@rstest/core";
import { buildFinalizedFootFromSavedDesign } from "@/features/exports/saved-design-finalized-mesh";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { ShoeWidthId } from "@/lib/geometry/shoe-width";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { DesignState, PlacedElement } from "@/types";

interface CaseSpec {
    id: string;
    width: ShoeWidthId;
    size?: number;
    heelCupHeightMm?: number;
    metPad?: boolean;
}

interface ExpectedFile {
    identity: CaseSpec[];
    defect: CaseSpec & { side: "left" };
}

const productRoot = resolve(process.env.GATE_PRODUCT_ROOT ?? process.cwd());
const specPath = process.env.GATE_CASES_JSON;
const outPath = process.env.GATE_OUT;
const only = new Set(
    (process.env.GATE_ONLY ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
);

function wanted(id: string): boolean {
    return only.size === 0 || only.has(id) || (id === "defect" && only.has("defect"));
}

function designFor(input: CaseSpec): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    if (input.size != null) design.usMenSize = input.size;
    design.shoeWidth = input.width;
    design.shoeWidthBySide = { left: input.width, right: input.width };
    if (input.heelCupHeightMm) {
        const patch = { heelCupHeightMm: input.heelCupHeightMm };
        design.corrections = {
            ...design.corrections,
            linked: true,
            left: { ...design.corrections.left, ...patch },
            right: { ...design.corrections.right, ...patch },
        };
    }
    if (input.metPad) {
        const layout = insoleLayoutFromDesign(design);
        const pose = defaultElementPose("met_pad", "left", layout.lengthMm, layout.widthMm);
        const el: PlacedElement = {
            id: "met-left",
            kind: "met_pad",
            side: "left",
            position: pose.position,
            rotationDeg: pose.rotationDeg,
            scale: pose.scale,
            heightMm: pose.heightMm,
            ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
        };
        design.elements = [el];
    }
    return design;
}

function meshHash(pos: ArrayBufferView, idx: ArrayBufferView): string {
    const h = createHash("sha256");
    h.update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength));
    h.update(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
    return h.digest("hex");
}

function clip(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 1200);
}

function sampleTopBuffer(): ArrayBuffer {
    const bytes = readFileSync(resolve(productRoot, "vertex/public/Templates/SAMPLE_Top.glb"));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function loadTemplate(): Promise<ArrayBuffer> {
    resetSampleTopGeometryCache();
    primeSampleTopGeometry(await sampleTopFromArrayBuffer(sampleTopBuffer()));
    return sampleTopBuffer();
}

async function exportLoft(design: DesignState) {
    resetManufacturingSolidCache();
    const field = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
    const options = printSolidOptions({
        design,
        side: "left",
        field,
        viewer: { wallModel: "procedural", wallStyle: "round" },
        trimline: null,
        bottomPattern: null,
    });
    return buildProceduralExportSolid(options);
}

describe("narrow heelcup preloft gates", () => {
    test("measure identity meshes and the order-shaped headless export", async () => {
        if (!specPath || !outPath) throw new Error("GATE_CASES_JSON and GATE_OUT are required");
        const spec = JSON.parse(readFileSync(specPath, "utf8")) as ExpectedFile;
        const report: {
            identity: Record<string, unknown>;
            defect: { loft?: unknown; headless?: unknown };
        } = { identity: {}, defect: {} };
        try {
            const sampleTop = await loadTemplate();
            for (const row of spec.identity) {
                if (!wanted(row.id)) continue;
                const started = Date.now();
                try {
                    const built = await exportLoft(designFor(row));
                    const pos = built.geometry.getAttribute("position").array as Float32Array;
                    const index = built.geometry.getIndex();
                    const idx = index ? (index.array as Uint32Array) : new Uint32Array();
                    report.identity[row.id] = {
                        ok: true,
                        ms: Date.now() - started,
                        verts: pos.length / 3,
                        hash: meshHash(pos, idx),
                    };
                    built.geometry.dispose();
                } catch (error) {
                    report.identity[row.id] = { ok: false, ms: Date.now() - started, message: clip(error) };
                }
            }
            if (wanted("defect") || wanted(spec.defect.id)) {
                const design = designFor(spec.defect);
                const loftStarted = Date.now();
                try {
                    const built = await exportLoft(design);
                    const pos = built.geometry.getAttribute("position").array as Float32Array;
                    const index = built.geometry.getIndex();
                    const idx = index ? (index.array as Uint32Array) : new Uint32Array();
                    report.defect.loft = {
                        ok: true,
                        ms: Date.now() - loftStarted,
                        verts: pos.length / 3,
                        hash: meshHash(pos, idx),
                    };
                    built.geometry.dispose();
                } catch (error) {
                    report.defect.loft = { ok: false, ms: Date.now() - loftStarted, message: clip(error) };
                }
                const headStarted = Date.now();
                try {
                    const viewer = useDesignStore.getState().viewer;
                    useDesignStore.setState({
                        viewer: { ...viewer, wallModel: "procedural", wallStyle: "round" },
                    });
                    const foot = await buildFinalizedFootFromSavedDesign({
                        design,
                        side: "left",
                        sampleTopBytes: sampleTop,
                        includeLeader: false,
                    });
                    report.defect.headless = {
                        ok: true,
                        ms: Date.now() - headStarted,
                        solidTriangles: foot.solidTriangles,
                        uploadTriangles: foot.uploadTriangles,
                        stlSha256: createHash("sha256").update(Buffer.from(foot.stl)).digest("hex"),
                    };
                } catch (error) {
                    report.defect.headless = {
                        ok: false,
                        ms: Date.now() - headStarted,
                        message: clip(error),
                    };
                }
            }
        } finally {
            writeFileSync(outPath, JSON.stringify(report, null, 2));
        }
    }, 900_000);
});
