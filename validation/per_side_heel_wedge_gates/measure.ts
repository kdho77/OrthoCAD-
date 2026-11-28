// Frozen measurement helpers for the per-side heel-wedge gates.
// Thresholds describe the existing heel post on BASE. They are not taken from the candidate.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { getBaseFootprintFrame, vertexFootprintAt, wedgeMmAtBaseVertex } from "@/lib/geometry/base-modifier";
import { bottomOutlineChordMm, REARFOOT_POST_U } from "@/lib/geometry/posting-degrees";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_GLB_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { wedgeDeltaAt } from "@/lib/geometry/wedge";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { DesignState, Side } from "@/types";
import { MCP_TOOL_DEFINITIONS, savedDesignCatalogSchema as mcpCatalogSchema } from "../../packages/mcp/src/tools/schemas";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../../vertex/server/src/auth/cad-operator";
import { persistSavedDesignSnapshotOnDesign } from "../../vertex/server/src/lib/saved-design-snapshot";
import { readStoredDesignSettings } from "../../vertex/shared/design-settings";
import { parseSavedDesignCatalog } from "../../vertex/shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../vertex/shared/saved-design-snapshot";
import type { BufferGeometry } from "three";

export const BASE_SHA = "268aac85847160b5b2703a05688721ea4cb93b24";

/** Heel station band around the existing rearfoot post (u = 0.15). */
export const HEEL_U0 = 0.1;
export const HEEL_U1 = 0.2;

/**
 * Right-foot height-field medial edge. Mesh medial is +Y on the right;
 * height-field vSigned is the opposite, so the right medial edge is v = −1.
 * Left medial is v = +1. Lateral is the other edge.
 */
export const RIGHT_MEDIAL_V = -1;
export const RIGHT_LATERAL_V = 1;

/** Field must match heelChord * tan(2°). 0.02 mm is float slack on an exact conversion. */
export const FIELD_TOL_MM = 0.02;
/** Export vertex lift must match the frozen existing-geometry lift. */
export const LIFT_TOL_MM = 0.05;

export const DESIGN_ID = "11111111-1111-4111-8111-111111111111";
export const ORDER_ID = "gate-order-right-wedge";

export const RIGHT_MEDIAL_2 = {
    shoe_size: { system: "US_M" as const, size: 9 },
    rearfoot_wedge_by_side: {
        right: { side: "medial" as const, value: 2, unit: "deg" as const, degree_mode: "station" as const },
    },
};

export const EXPECTED_WEDGE = {
    side: "medial",
    value: 2,
    unit: "deg",
    degreeMode: "station",
} as const;

const STOCK_CATALOG = { shoe_size: { system: "US_M" as const, size: 9 } };
const BILATERAL_WEDGE_CATALOG = {
    shoe_size: { system: "US_M" as const, size: 9 },
    rearfoot_wedge: { side: "medial" as const, value: 2, unit: "deg" as const, degree_mode: "station" as const },
};
const BILATERAL_POSTING_CATALOG = {
    shoe_size: { system: "US_M" as const, size: 9 },
    sliders: { rearfoot_posting_deg: 2 },
};

export interface HeelExtreme {
    v: number;
    liftMm: number;
    fieldMm: number;
    index: number;
}

export interface MeshPair {
    md5: string;
    medial: HeelExtreme;
    lateral: HeelExtreme;
}

export interface BuiltDesign {
    design: DesignState;
    sha256: string;
}

const rawCache = new Map<Side, BufferGeometry>();

export function sha256Json(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function md5Bytes(bytes: ArrayBuffer): string {
    return createHash("md5").update(Buffer.from(bytes)).digest("hex");
}

export function gitText(args: string[]): string {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
}

export function changedProductFiles(): string[] {
    const tracked = gitText(["diff", "--name-only", BASE_SHA]);
    const untracked = gitText(["ls-files", "--others", "--exclude-standard"]);
    const skip = "validation/per_side_heel_wedge_gates/";
    return [...tracked.split("\n"), ...untracked.split("\n")]
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith(skip));
}

export function productDiffAddedLines(): string[] {
    const diff = gitText([
        "diff",
        "-U0",
        BASE_SHA,
        "--",
        ".",
        ":!validation/per_side_heel_wedge_gates",
    ]);
    return diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

export function buildCatalog(catalog: unknown): BuiltDesign {
    const parsed = parseSavedDesignCatalog(catalog);
    const built = buildSavedDesignSnapshot({ stored: null, catalog: parsed });
    return { design: built.design, sha256: sha256Json(built.design) };
}

export function stockDesign(): BuiltDesign {
    return buildCatalog(STOCK_CATALOG);
}

export function bilateralWedgeDesign(): BuiltDesign {
    return buildCatalog(BILATERAL_WEDGE_CATALOG);
}

export function bilateralPostingDesign(): BuiltDesign {
    return buildCatalog(BILATERAL_POSTING_CATALOG);
}

/** Existing per-foot field. This is the geometry the catalog must reuse, not a new post. */
export function directRightMedialDesign(): BuiltDesign {
    const built = stockDesign();
    built.design.corrections.linked = false;
    built.design.corrections.right.rearfootWedge = { ...EXPECTED_WEDGE };
    return { design: built.design, sha256: sha256Json(built.design) };
}

export function expectedRiseMm(design: DesignState, side: Side): { chordMm: number; expectedMm: number } {
    const field = baseModifierField(design, side, design.thicknessMm);
    const chordMm = bottomOutlineChordMm(REARFOOT_POST_U, {
        lengthMm: field.lengthMm,
        widthMm: field.widthMm,
        shoeWidth: field.shoeWidth,
    });
    const expectedMm = chordMm * Math.tan((2 * Math.PI) / 180);
    return { chordMm, expectedMm };
}

export function edgeFieldsMm(design: DesignState, side: Side): { medialMm: number; lateralMm: number } {
    const field = baseModifierField(design, side, design.thicknessMm);
    const params = {
        lengthMm: field.lengthMm,
        widthMm: field.widthMm,
        trimline: field.trimline ?? null,
        shoeWidth: field.shoeWidth,
    };
    const medialV = side === "right" ? RIGHT_MEDIAL_V : -RIGHT_MEDIAL_V;
    const lateralV = -medialV;
    return {
        medialMm: wedgeDeltaAt(REARFOOT_POST_U, medialV, side, field.corrections, params),
        lateralMm: wedgeDeltaAt(REARFOOT_POST_U, lateralV, side, field.corrections, params),
    };
}

async function loadSide(side: Side): Promise<BufferGeometry> {
    const cached = rawCache.get(side);
    if (cached) return cached;
    const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
    let raw = await sampleTopFromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (side === "left") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    rawCache.set(side, raw);
    return raw;
}

export async function composeSide(design: DesignState, side: Side): Promise<BufferGeometry> {
    const raw = (await loadSide(side)).clone();
    const field = baseModifierField(design, side, design.thicknessMm);
    const composed = await composePrintSolidTop(raw, { sourceField: field });
    if (composed !== raw) raw.dispose();
    return composed;
}

export function stlMd5(geometry: BufferGeometry): string {
    return md5Bytes(geometryToBinarySTL(geometry));
}

export function heelExtremes(
    raw: BufferGeometry,
    posted: BufferGeometry,
    neutral: BufferGeometry,
    fieldDesign: DesignState,
): { medial: HeelExtreme; lateral: HeelExtreme } {
    const frame = getBaseFootprintFrame(raw, "right");
    const basePos = raw.getAttribute("position")!.array as Float32Array;
    const postedPos = posted.getAttribute("position")!.array as Float32Array;
    const neutralPos = neutral.getAttribute("position")!.array as Float32Array;
    if (postedPos.length !== basePos.length || neutralPos.length !== basePos.length) {
        throw new Error(
            `vertex count changed: raw ${basePos.length} posted ${postedPos.length} neutral ${neutralPos.length}`,
        );
    }
    const field = baseModifierField(fieldDesign, "right", fieldDesign.thicknessMm);
    const ta = frame.thickAxis;
    let medial: HeelExtreme = { v: Infinity, liftMm: 0, fieldMm: 0, index: -1 };
    let lateral: HeelExtreme = { v: -Infinity, liftMm: 0, fieldMm: 0, index: -1 };
    const n = basePos.length / 3;
    for (let i = 0; i < n; i++) {
        const { u, vSigned } = vertexFootprintAt(frame, basePos, i);
        if (u < HEEL_U0 || u > HEEL_U1) continue;
        const liftMm = postedPos[i * 3 + ta]! - neutralPos[i * 3 + ta]!;
        const fieldMm = wedgeMmAtBaseVertex(raw, field, i);
        if (vSigned < medial.v) medial = { v: vSigned, liftMm, fieldMm, index: i };
        if (vSigned > lateral.v) lateral = { v: vSigned, liftMm, fieldMm, index: i };
    }
    return { medial, lateral };
}

export async function exportRightAgainstStock(design: DesignState, stock: DesignState): Promise<MeshPair> {
    const raw = (await loadSide("right")).clone();
    const field = baseModifierField(design, "right", design.thicknessMm);
    const neutralField = baseModifierField(stock, "right", stock.thicknessMm);
    const posted = await composePrintSolidTop(raw.clone(), { sourceField: field });
    const neutral = await composePrintSolidTop(raw.clone(), { sourceField: neutralField });
    const extremes = heelExtremes(raw, posted, neutral, design);
    const md5 = stlMd5(posted);
    posted.dispose();
    neutral.dispose();
    raw.dispose();
    return { md5, ...extremes };
}

export function isSampleTop(design: DesignState): boolean {
    return (
        design.base?.assetId === SAMPLE_TOP_ASSET_ID &&
        design.base.glbPath === SAMPLE_TOP_GLB_PATH &&
        design.paired?.rightBase?.mirrored === true &&
        design.dogfoodManufacturing?.template === "SAMPLE_Top"
    );
}

export interface PersistReadback {
    right: { side?: string; value?: number; unit?: string; degreeMode?: string } | undefined;
    left: { side?: string; value?: number; unit?: string; degreeMode?: string } | undefined;
    leftPostingDeg: number | undefined;
    rightPostingDeg: number | undefined;
    linked: boolean | undefined;
    textSurface: string | undefined;
    textMode: string | undefined;
}

export async function persistRightMedial(): Promise<PersistReadback> {
    const principal: CadOperatorPrincipal = {
        kind: "cad_operator",
        credentialId: "cred-dogfood",
        tenantId: DOGFOOD_TENANT_ID,
        scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
    };
    const current = {
        id: DESIGN_ID,
        ownerId: "22222222-2222-4222-8222-222222222222",
        name: "Fixture insole",
        kind: "insole",
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 2,
        linked: true,
        unit: "mm",
        settingsJson: null,
        updatedAt: "2026-11-23T00:00:00.000Z",
        deletedAt: null,
        client: { tenantId: DOGFOOD_TENANT_ID },
        integrationLink: {
            tenantId: DOGFOOD_TENANT_ID,
            source: "vo2",
            externalOrderId: ORDER_ID,
            sides: "pair",
            shoeSizeSystem: "US_M" as const,
            shoeSize: 9,
            shoeSizeLeft: null,
            shoeSizeRight: null,
            shoeWidth: "medium",
        },
    };
    const prisma = {
        design: {
            findUnique: async () => current,
            update: async () => ({ id: DESIGN_ID }),
        },
    };
    const result = await persistSavedDesignSnapshotOnDesign({
        prisma: prisma as never,
        principal,
        designId: DESIGN_ID,
        catalog: RIGHT_MEDIAL_2,
        buildSnapshot: buildSavedDesignSnapshot,
    });
    const settings = readStoredDesignSettings(result.settingsJson);
    const corrections = settings?.corrections as
        | {
              linked?: boolean;
              left?: { rearfootWedge?: PersistReadback["left"]; rearfootPostingDeg?: number };
              right?: { rearfootWedge?: PersistReadback["right"]; rearfootPostingDeg?: number };
          }
        | undefined;
    const marking = settings?.textMarking as { surface?: string; mode?: string } | undefined;
    return {
        right: corrections?.right?.rearfootWedge,
        left: corrections?.left?.rearfootWedge,
        leftPostingDeg: corrections?.left?.rearfootPostingDeg,
        rightPostingDeg: corrections?.right?.rearfootPostingDeg,
        linked: corrections?.linked,
        textSurface: marking?.surface,
        textMode: marking?.mode,
    };
}

export function toolDescriptions(): { persist: string; create: string; bundle: string } {
    const persist = MCP_TOOL_DEFINITIONS.find((tool) => tool.name === "persist_saved_design_snapshot");
    const create = MCP_TOOL_DEFINITIONS.find((tool) => tool.name === "create_saved_design");
    const bundle = readFileSync(resolve(process.cwd(), "vertex/server/src/orthocad-mcp.bundled.mjs"), "utf8");
    return {
        persist: persist?.description ?? "",
        create: create?.description ?? "",
        bundle,
    };
}

export function mcpAccepts(catalog: unknown): { ok: boolean; error: string } {
    const parsed = mcpCatalogSchema.safeParse(catalog);
    if (parsed.success) return { ok: true, error: "" };
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join(".") ?? "catalog"}: ${issue?.message ?? "invalid"}` };
}

export function sharedAccepts(catalog: unknown): { ok: boolean; error: string } {
    try {
        parseSavedDesignCatalog(catalog);
        return { ok: true, error: "" };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export function documentsMedialAndLateral(text: string): boolean {
    return /raises the medial/i.test(text) && /raises the lateral/i.test(text) && text.includes("rearfoot_wedge_by_side");
}
