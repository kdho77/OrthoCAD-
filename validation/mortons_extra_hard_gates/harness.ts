// Slice-request harness. Calls the existing collect / 3MF / VertexSlice form path.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    buildFinalizedFootFromSavedSettings,
    buildRegional3mfFromSavedSettings,
    designStateFromSavedSettings,
} from "@/features/exports/saved-design-finalized-mesh";
import { buildVertexSliceModel } from "@/features/exports/vertexslice-regional-model";
import { elementHeightAt } from "@/lib/geometry/elements";
import { heightFieldYFromMeshY } from "@/lib/geometry/handedness";
import { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_GLB_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { collectHardnessRegions } from "@/lib/hardness/collect";
import { readPackedHardness3mf } from "@/lib/hardness/export-3mf";
import { LIFT_THRESHOLD_MM, type TriangleMesh } from "@/lib/hardness/mesh";
import type { DesignState, PlacedElement, Side } from "@/types";
import {
    CAD_OPERATOR_BELT_MATERIAL,
    CAD_OPERATOR_BELT_PROFILE_ID,
} from "../../vertex/server/src/auth/cad-operator";
import { infillPctForCadSlice } from "../../vertex/server/src/lib/cad-operator-production";
import { sliceWithVertexSlice } from "../../vertex/server/src/lib/vertexslice-client";
import { designSettingsEnvelope } from "../../vertex/shared/design-settings";
import {
    classDensityPct,
    classLineWidthMm,
    classSpeedMmS,
    HARDNESS_CLASS_TABLE,
    SPARSE_INFILL_PATTERN,
} from "../../vertex/shared/print-recipe/hardness-class-table";
import {
    bindPrintRecipeProfile,
    type PrintRecipeV1,
    printRecipeV1Schema,
} from "../../vertex/shared/print-recipe/print-recipe";
import { parseSavedDesignCatalog, type StoredLinkShoe } from "../../vertex/shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../vertex/shared/saved-design-snapshot";
import { selectVertexSliceUpload } from "../../vertex/shared/vertexslice-regional-3mf";
import { BASE_SHA, FOOTPRINT_TOL_MM, HEEL_X_MM } from "./thresholds";

export const REPO_ROOT = resolve(import.meta.dirname, "../..");

export const STORED_MENS_9: StoredLinkShoe = {
    system: "US_M",
    size: 9,
    left: null,
    right: null,
    width: null,
};

export function sha256(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return createHash("sha256").update(view).digest("hex");
}

export function sha256Text(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

function arrayBufferOf(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function boxStl(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ArrayBuffer {
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

/** Stand-in shell. Modifier prisms come from the design sampler, not these triangles. */
export function standInShell(): ArrayBuffer {
    return boxStl(0, -48, 0, 275, 48, 8);
}

export function loadSavedDesign(catalog: unknown): DesignState {
    const built = buildSavedDesignSnapshot({
        stored: STORED_MENS_9,
        catalog: parseSavedDesignCatalog(catalog),
    });
    const envelope = designSettingsEnvelope(built.design as unknown as Record<string, unknown>);
    return designStateFromSavedSettings(envelope);
}

export function envelopeOf(design: DesignState): unknown {
    return designSettingsEnvelope(design as unknown as Record<string, unknown>);
}

export function elementOn(design: DesignState, kind: string, side: Side): PlacedElement {
    const found = design.elements.find((el) => el.kind === kind && el.side === side);
    if (!found) throw new Error(`saved design has no ${kind} on ${side}`);
    return found;
}

export function recipeOf(design: DesignState): PrintRecipeV1 {
    const parsed = printRecipeV1Schema.safeParse(design.printRecipe);
    return bindPrintRecipeProfile(parsed.success ? parsed.data : undefined, CAD_OPERATOR_BELT_PROFILE_ID);
}

export function deviceInfillPct(design: DesignState): number {
    return infillPctForCadSlice(CAD_OPERATOR_BELT_PROFILE_ID, recipeOf(design));
}

export interface FootprintStats {
    cells: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    centroidY: number;
}

/** Morton's / pad planform in mesh Y, sampled through elementHeightAt's height-field contract. */
export function footprintMeshY(
    design: DesignState,
    el: PlacedElement,
    stepMm = 1,
): FootprintStats & {
    points: Array<{ x: number; y: number }>;
} {
    const layout = insoleLayoutFromDesign(design);
    const points: Array<{ x: number; y: number }> = [];
    const y0 = -layout.widthMm / 2;
    const y1 = layout.widthMm / 2;
    for (let x = 0; x <= layout.lengthMm; x += stepMm) {
        for (let meshY = y0; meshY <= y1; meshY += stepMm) {
            const lift = elementHeightAt(
                [el],
                x,
                heightFieldYFromMeshY(meshY),
                layout.lengthMm,
                layout.widthMm,
            );
            if (lift >= LIFT_THRESHOLD_MM) points.push({ x, y: meshY });
        }
    }
    return { ...boundsOf(points), points };
}

function boundsOf(points: Array<{ x: number; y: number }>): FootprintStats {
    if (points.length === 0) {
        return {
            cells: 0,
            minX: Number.NaN,
            minY: Number.NaN,
            maxX: Number.NaN,
            maxY: Number.NaN,
            centroidY: Number.NaN,
        };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let sumY = 0;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
        sumY += p.y;
    }
    return { cells: points.length, minX, minY, maxX, maxY, centroidY: sumY / points.length };
}

export interface ModifierCoverage {
    modifierCount: number;
    density: string;
    pattern: string;
    lineWidth: string;
    speed: string;
    hardnessClass: string;
    name: string;
    verticesOutside: number;
    cellCoverage: number;
    heelClearanceMm: number;
    modifierMinX: number;
    modifierMaxX: number;
    modifierMinY: number;
    modifierMaxY: number;
    centroidDeltaY: number;
}

export function coverFootprint(
    stats: FootprintStats & { points: Array<{ x: number; y: number }> },
    mesh: TriangleMesh | null,
): ModifierCoverage {
    const empty: ModifierCoverage = {
        modifierCount: mesh ? 1 : 0,
        density: "",
        pattern: "",
        lineWidth: "",
        speed: "",
        hardnessClass: "",
        name: "",
        verticesOutside: mesh ? Number.POSITIVE_INFINITY : 0,
        cellCoverage: 0,
        heelClearanceMm: Number.NaN,
        modifierMinX: Number.NaN,
        modifierMaxX: Number.NaN,
        modifierMinY: Number.NaN,
        modifierMaxY: Number.NaN,
        centroidDeltaY: Number.NaN,
    };
    if (!mesh || mesh.positions.length === 0) return empty;
    const vertices: Array<{ x: number; y: number }> = [];
    const seen = new Set<string>();
    for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i] ?? 0;
        const y = mesh.positions[i + 1] ?? 0;
        const key = `${x.toFixed(3)}:${y.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        vertices.push({ x, y });
    }
    const box = boundsOf(vertices);
    const nearFoot = expandedKeys(stats.points, FOOTPRINT_TOL_MM);
    const nearMod = expandedKeys(vertices, FOOTPRINT_TOL_MM);
    let outside = 0;
    for (const v of vertices) {
        if (!nearFoot.has(gridKey(v.x, v.y))) outside += 1;
    }
    let covered = 0;
    for (const p of stats.points) {
        if (nearMod.has(gridKey(p.x, p.y))) covered += 1;
    }
    return {
        ...empty,
        modifierCount: 1,
        verticesOutside: outside,
        cellCoverage: stats.points.length === 0 ? 0 : covered / stats.points.length,
        heelClearanceMm: box.minX - HEEL_X_MM,
        modifierMinX: box.minX,
        modifierMaxX: box.maxX,
        modifierMinY: box.minY,
        modifierMaxY: box.maxY,
        centroidDeltaY: box.centroidY - stats.centroidY,
    };
}

function gridKey(x: number, y: number): string {
    return `${Math.round(x)}:${Math.round(y)}`;
}

function expandedKeys(points: Array<{ x: number; y: number }>, tolMm: number): Set<string> {
    const keys = new Set<string>();
    const r = Math.ceil(tolMm);
    const r2 = tolMm * tolMm;
    for (const p of points) {
        const ix = Math.round(p.x);
        const iy = Math.round(p.y);
        for (let dx = -r; dx <= r; dx += 1) {
            for (let dy = -r; dy <= r; dy += 1) {
                if (dx * dx + dy * dy <= r2 + 1e-6) keys.add(`${ix + dx}:${iy + dy}`);
            }
        }
    }
    return keys;
}

export interface PackedModifier {
    density: string;
    pattern: string;
    lineWidth: string;
    speed: string;
    hardnessClass: string;
    name: string;
    mesh: TriangleMesh;
    metaKeys: string[];
}

export interface RegionalPack {
    threw: boolean;
    error: string;
    bytes: Uint8Array | null;
    filename: string;
    contentType: string;
    uploadEqualsStl: boolean;
    modelSha256: string;
    modifiers: PackedModifier[];
    shellMeta: Record<string, string>;
    regionCount: number;
}

function errorText(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return message.replace(/\s+/g, " ").slice(0, 400);
}

export async function regionalPack(
    design: DesignState,
    side: Side,
    shell: ArrayBuffer,
): Promise<RegionalPack> {
    const stlName = `${side}.stl`;
    const stlBytes = new Uint8Array(shell.slice(0));
    try {
        const regional = await buildRegional3mfFromSavedSettings({
            settingsJson: envelopeOf(design),
            side,
            manufacturingStl: shell,
        });
        const browser = await buildVertexSliceModel({
            design,
            side,
            manufacturingStl: shell,
            stlFilename: stlName,
            regional3mfEnabled: true,
        });
        if (regional === null) {
            if (browser.contentType !== "model/stl") {
                throw new Error("browser export returned 3MF while the server regional pack returned none");
            }
            if (sha256(browser.bytes) !== sha256(stlBytes)) {
                throw new Error("browser STL bytes differ from the manufacturing STL");
            }
        } else if (sha256(browser.bytes) !== sha256(regional.bytes)) {
            throw new Error("browser 3MF bytes differ from buildRegional3mfFromSavedSettings");
        }
        const upload = selectVertexSliceUpload({
            stl: stlBytes,
            stlFilename: stlName,
            regional3mf: regional,
            regional3mfEnabled: true,
        });
        const modifiers: PackedModifier[] = [];
        let shellMeta: Record<string, string> = {};
        if (upload.contentType === "model/3mf") {
            const read = await readPackedHardness3mf(upload.bytes);
            const parsed = await parseSettings(upload.bytes);
            shellMeta = parsed.shell;
            for (const mod of read.modifiers) {
                modifiers.push({
                    density: mod.density,
                    pattern: mod.pattern,
                    lineWidth: mod.lineWidth,
                    speed: mod.speed ?? "",
                    hardnessClass: mod.hardnessClass,
                    name: mod.name,
                    mesh: mod.mesh,
                    metaKeys: parsed.modifiers[modifiers.length] ?? [],
                });
            }
        }
        return {
            threw: false,
            error: "",
            bytes: upload.bytes,
            filename: upload.filename,
            contentType: upload.contentType,
            uploadEqualsStl: sha256(upload.bytes) === sha256(stlBytes),
            modelSha256: sha256(upload.bytes),
            modifiers,
            shellMeta,
            regionCount: regional?.regionCount ?? 0,
        };
    } catch (err) {
        return {
            threw: true,
            error: errorText(err),
            bytes: null,
            filename: "",
            contentType: "",
            uploadEqualsStl: false,
            modelSha256: "",
            modifiers: [],
            shellMeta: {},
            regionCount: 0,
        };
    }
}

async function parseSettings(
    bytes: Uint8Array,
): Promise<{ shell: Record<string, string>; modifiers: string[][] }> {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("Metadata/model_settings.config")?.async("string");
    if (!xml) return { shell: {}, modifiers: [] };
    const shell: Record<string, string> = {};
    const modifiers: string[][] = [];
    const partRe = /<part id="(\d+)" subtype="([^"]+)">([\s\S]*?)<\/part>/g;
    for (const match of xml.matchAll(partRe)) {
        const subtype = match[2] ?? "";
        const body = match[3] ?? "";
        const keys: string[] = [];
        const meta: Record<string, string> = {};
        const metaRe = /<metadata type="volume" key="([^"]+)" value="([^"]*)"\/>/g;
        for (const item of body.matchAll(metaRe)) {
            const key = item[1] ?? "";
            keys.push(key);
            meta[key] = item[2] ?? "";
        }
        keys.sort();
        if (subtype === "normal_part") Object.assign(shell, meta);
        if (subtype === "modifier_part") modifiers.push(keys);
    }
    return { shell, modifiers };
}

export interface FormCapture {
    keys: string[];
    fields: Record<string, string>;
    /** Name the slice client logs for the model part (`left.stl` or `model.3mf`). */
    loggedModel: string;
    liveSlicerConfigured: boolean;
}

const LIVE_SLICER_CONFIGURED = Boolean(process.env.VERTEXSLICE_SLICER_URL?.trim());

export function liveSlicerConfigured(): boolean {
    return LIVE_SLICER_CONFIGURED;
}

export async function captureProductionForm(args: {
    model: Uint8Array;
    filename: string;
    infillDensityPct: number;
    expectedRegionCount?: number;
}): Promise<FormCapture> {
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.VERTEXSLICE_SLICER_URL;
    const previousKey = process.env.VERTEXSLICE_API_KEY;
    const previousLog = console.log;
    let captured: FormData | null = null;
    let loggedModel = "";
    process.env.VERTEXSLICE_SLICER_URL = "https://slicer.invalid";
    process.env.VERTEXSLICE_API_KEY = "gate-dummy";
    console.log = (...args: unknown[]) => {
        const detail = args[1];
        if (
            args[0] === "[vertexslice] -> POST /v1/slice" &&
            detail &&
            typeof detail === "object" &&
            "model" in detail
        ) {
            const model = (detail as { model?: unknown }).model;
            if (typeof model === "string") loggedModel = model;
        }
        previousLog.apply(console, args);
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/v1/materials")) {
            return new Response(JSON.stringify({ materials: ["apex_core", "apex_light"] }), { status: 200 });
        }
        captured = init?.body instanceof FormData ? init.body : null;
        const headers = new Headers();
        if ((args.expectedRegionCount ?? 0) > 0)
            headers.set("X-VertexSlice-Regions", String(args.expectedRegionCount));
        return new Response("G0 X0\n", { status: 200, headers });
    }) as typeof fetch;
    try {
        await sliceWithVertexSlice({
            profileId: CAD_OPERATOR_BELT_PROFILE_ID,
            material: CAD_OPERATOR_BELT_MATERIAL,
            model: args.model,
            filename: args.filename,
            infillDensityPct: args.infillDensityPct,
            expectedRegionCount: args.expectedRegionCount,
            side: "left",
        });
    } finally {
        globalThis.fetch = previousFetch;
        console.log = previousLog;
        if (previousUrl === undefined) delete process.env.VERTEXSLICE_SLICER_URL;
        else process.env.VERTEXSLICE_SLICER_URL = previousUrl;
        if (previousKey === undefined) delete process.env.VERTEXSLICE_API_KEY;
        else process.env.VERTEXSLICE_API_KEY = previousKey;
    }
    if (!captured) throw new Error("production slice did not build a form");
    const form = captured as FormData;
    const keys = [...form.keys()].sort();
    const fields: Record<string, string> = {};
    for (const key of keys) {
        if (key === "model") continue;
        const value = form.get(key);
        fields[key] = typeof value === "string" ? value : "";
    }
    if (!form.get("model")) throw new Error("production form has no model part");
    return { keys, fields, loggedModel, liveSlicerConfigured: LIVE_SLICER_CONFIGURED };
}

export function productDiffNames(): string[] {
    const out = execFileSync(
        "git",
        ["diff", "--name-only", BASE_SHA, "--", ".", ":(exclude)validation/mortons_extra_hard_gates"],
        { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

export function addedProductFiles(): string[] {
    const out = execFileSync(
        "git",
        [
            "diff",
            "--name-only",
            "--diff-filter=A",
            BASE_SHA,
            "--",
            ".",
            ":(exclude)validation/mortons_extra_hard_gates",
        ],
        { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

export function diffAddedLines(): string[] {
    const out = execFileSync(
        "git",
        ["diff", "-U0", BASE_SHA, "--", ".", ":(exclude)validation/mortons_extra_hard_gates"],
        { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

export function classRow(name: keyof typeof HARDNESS_CLASS_TABLE): {
    densityPct: number;
    lineWidthMm: number;
    speedMmS: number;
    pattern: string;
} {
    const row = HARDNESS_CLASS_TABLE[name];
    if (!("sparseInfillDensityPct" in row)) throw new Error(`${name} is not a named class`);
    return {
        densityPct: row.sparseInfillDensityPct,
        lineWidthMm: row.sparseInfillLineWidthMm,
        speedMmS: row.sparseInfillSpeedMmS,
        pattern: row.sparseInfillPattern,
    };
}

export function regionDensity(
    design: DesignState,
    el: PlacedElement,
): {
    count: number;
    hardnessClass: string;
    densityPct: number;
    lineWidthMm: number;
    speedMmS: number;
    pattern: string;
} {
    const regions = collectHardnessRegions(design, el.side).filter((region) => region.elementId === el.id);
    const region = regions[0];
    if (!region) {
        return {
            count: 0,
            hardnessClass: "",
            densityPct: Number.NaN,
            lineWidthMm: Number.NaN,
            speedMmS: Number.NaN,
            pattern: "",
        };
    }
    return {
        count: regions.length,
        hardnessClass: region.hardnessClass,
        densityPct: classDensityPct(region.hardnessClass, region.overrides),
        lineWidthMm: classLineWidthMm(region.hardnessClass),
        speedMmS: classSpeedMmS(region.hardnessClass) ?? Number.NaN,
        pattern: SPARSE_INFILL_PATTERN,
    };
}

export async function loftLeft(design: DesignState): Promise<{ sha256: string; triangles: number }> {
    const sample = readFileSync(resolve(REPO_ROOT, "vertex/public/Templates/SAMPLE_Top.glb"));
    const font = readFileSync(resolve(REPO_ROOT, "vertex/public/fonts/Inter-Bold.ttf"));
    const foot = await buildFinalizedFootFromSavedSettings({
        settingsJson: envelopeOf(design),
        side: "left",
        sampleTopBytes: arrayBufferOf(sample),
        fontBytes: arrayBufferOf(font),
        elementsBaseDir: resolve(REPO_ROOT, "vertex/public/elements"),
        includeLeader: true,
    });
    return { sha256: sha256(foot.stl), triangles: foot.uploadTriangles };
}

export function textMarkingFacts(design: DesignState): { surface: string; mode: string; sha256: string } {
    const marking = design.textMarking;
    return {
        surface: marking?.surface ?? "",
        mode: marking?.mode ?? "",
        sha256: sha256Text(JSON.stringify(marking ?? null)),
    };
}

export function sampleTopFacts(design: DesignState): { assetId: string; glbPath: string } {
    return {
        assetId: design.base?.assetId ?? "",
        glbPath: design.base?.glbPath ?? "",
    };
}

export { CAD_OPERATOR_BELT_MATERIAL, CAD_OPERATOR_BELT_PROFILE_ID, SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_GLB_PATH };

export interface FrozenBaseline {
    baseSha: string;
    stockLeftStlSha256: string;
    metUnsetLeftStlSha256: string;
    mortonsUnsetLeftStlSha256: string;
    explicitSplitOffModelSha256: string;
    explicitSplitOnThrew: boolean;
    explicitSplitOnError: string;
    explicitSplitOnModelSha256: string;
    metSoftModelSha256: string;
    textMarkingSha256: string;
}

export const BASELINE_PATH = resolve(import.meta.dirname, "baseline.json");

export function readBaseline(): FrozenBaseline {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as FrozenBaseline;
}

export function writeBaseline(baseline: FrozenBaseline): void {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}
