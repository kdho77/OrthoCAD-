import {
    type ApexPrintMaterialId,
    afoShellSliceFields,
    DEFAULT_APEX_PRINT_MATERIAL_ID,
    isApexPrintMaterialExportReady,
    lockedProfileIdForApexMaterial,
    type VertexSliceMaterialId,
    vertexSliceMaterialForApexMaterial,
} from "@/features/exports/apex-print-material";
import { exportMachineFamily, pairExportLayout } from "@/features/exports/machine-export-layout";
import { stampSingleFootStl } from "@/features/exports/printer-foot-isolation";
import {
    buildVertexSliceModel,
    parseRegionalCapability,
    type RegionalCapability,
    regionalSliceDecision,
} from "@/features/exports/vertexslice-regional-model";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { generateCncJob } from "@/lib/cnc/export";
import type { MillingProfile } from "@/lib/cnc/types";
import {
    buildExportGlb,
    buildExportStl,
    buildOrderPairGeometry,
    buildOrderPairStl,
    exportModeFromMethod,
    orderDownloadSides,
} from "@/lib/geometry/export-geometry";
import { binaryStlTriangleCount, manufacturingStlForExportKind } from "@/lib/geometry/leader-block";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { effectiveHardnessRegions } from "@/lib/hardness/collect";
import { packHardness3mf } from "@/lib/hardness/export-3mf";
import { parseBinaryStl, type TriangleMesh } from "@/lib/hardness/mesh";
import { buildRawModifiers, exportHardness3mf, STL_SHELL_ONLY_WARNING } from "@/lib/hardness/pipeline";
import { buildExportReport, type HardnessExportReport } from "@/lib/hardness/report";
import { type ResolvedModifier, resolveModifiers } from "@/lib/hardness/resolve";
import { type CamOverrides, type CamResult, generateGcode, type PrinterPreset } from "@/lib/kiri";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { mapClientRpcError } from "@/lib/trpc-errors";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import type { DesignState, ExportFormat, GrindingStyle, Side } from "@/types";
import {
    buildExportFilename,
    canonicalExportMaterialName,
    exportSideSuffix,
} from "../../../shared/export-filename";
import { classDensityPct } from "../../../shared/print-recipe/hardness-class-table";
import { bindPrintRecipeProfile } from "../../../shared/print-recipe/print-recipe";

function activeExportPatientParts(): { firstName: string; lastName: string } {
    const { activeClientId, clients } = useClientStore.getState();
    if (!activeClientId) return { firstName: "", lastName: "" };
    const client = clients.find((row) => row.id === activeClientId);
    if (!client) return { firstName: "", lastName: "" };
    return { firstName: client.firstName ?? "", lastName: client.lastName ?? "" };
}

function userExportFilename(input: {
    sides: Side | Side[];
    ext: string;
    material?: string | ApexPrintMaterialId | null;
}): string {
    const patient = activeExportPatientParts();
    const sideArg = Array.isArray(input.sides) ? input.sides : input.sides;
    const material =
        input.material != null && String(input.material).trim()
            ? canonicalExportMaterialName(String(input.material))
            : DEFAULT_APEX_PRINT_MATERIAL_ID;
    return buildExportFilename({
        firstName: patient.firstName,
        lastName: patient.lastName,
        material,
        side: exportSideSuffix(sideArg),
        ext: input.ext,
    });
}

// Re-export for convenience in UI components
export type GrindingStyleInput = GrindingStyle;

/** Print STL, 3MF, GLB, and print G-code are refused for a milling order. */
export const MILLED_ORDER_PRINT_REASON = "Milled orders export an L+R CNC file only";

export function isMilledOrder(design: DesignState): boolean {
    return design.method === "milling_3axis";
}

/** A milled order always mills every foot on the order. The active-foot toggle does not apply. */
export function cncSidesForOrder(design: DesignState, requested: Side[]): Side[] {
    if (!isMilledOrder(design)) return requested;
    const sides = orderDownloadSides(design);
    return sides.length > 0 ? sides : requested;
}

function refuseMilledPrint(design: DesignState): ExportOutcome | null {
    if (!isMilledOrder(design)) return null;
    return { ok: false, reason: MILLED_ORDER_PRINT_REASON };
}

function recordExport(detail: string) {
    useAuditStore.getState().record("export_generated", detail);
    const designId = useClientStore.getState().activeDesignId;
    if (designId) useClientStore.getState().markExported(designId);
}

export interface ExportOutcome {
    ok: boolean;
    reason?: string;
    filename?: string;
    /** Set when one Export action downloads more than one file. */
    filenames?: string[];
    blob?: Blob;
    stats?: CamResult["stats"];
    productionId?: string;
    warning?: string;
    report?: HardnessExportReport;
    cancelled?: boolean;
}

function applyServerBalance(balance: number | undefined): void {
    if (typeof balance !== "number") return;
    const { user, setUser } = useAuthStore.getState();
    if (user) setUser({ ...user, tokenBalance: balance });
}

async function uploadManufacturingStlDirect(
    side: Side,
    body: ArrayBuffer,
    contentType: "model/stl" | "model/3mf" = "model/stl",
): Promise<string> {
    const prep = await trpc.manufacturing.prepareManufacturingStlUpload.mutate({
        side,
        fileName: contentType === "model/3mf" ? `manufacturing-${side}.3mf` : `manufacturing-${side}.stl`,
    });
    const putHeaders: Record<string, string> = { "Content-Type": contentType };
    if (prep.token) putHeaders.Authorization = `Bearer ${prep.token}`;
    const putRes = await fetch(prep.uploadUrl, {
        method: "PUT",
        headers: putHeaders,
        body,
    });
    if (!putRes.ok) {
        const detail = await putRes.text().catch(() => "");
        throw new Error(
            `Manufacturing STL upload failed (${putRes.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`,
        );
    }
    return prep.storageKey;
}

/** Export the finalized viewer solid as binary STL (mesh-close primary export path). */
async function buildManufacturingStl(side: Side): Promise<ArrayBuffer> {
    const { design } = useDesignStore.getState();
    return buildExportStl(side, { exportMode: exportModeFromMethod(design.method) });
}

async function authorize(
    format: "stl" | "gcode",
    side: Side,
    fileName: string,
): Promise<{ ok: boolean; reason?: string }> {
    const { user, license, deductTokens, setUser } = useAuthStore.getState();
    if (isApiConfigured()) {
        try {
            const res = await trpc.export.authorize.mutate({ format, side, fileName });
            if (!res.ok) return { ok: false, reason: "Authorization denied" };
            if (user) setUser({ ...user, tokenBalance: res.balance });
            return { ok: true };
        } catch (e) {
            const raw = e instanceof Error ? e.message : "Export authorization failed";
            return { ok: false, reason: mapClientRpcError(raw, "Export authorization failed") };
        }
    }
    const check = canExport(user, license, format);
    if (!check.ok) return { ok: false, reason: check.reason };
    deductTokens(TOKEN_COST[format]);
    return { ok: true };
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export async function exportDesign(format: ExportFormat, side: Side = "left"): Promise<ExportOutcome> {
    const blocked = refuseMilledPrint(useDesignStore.getState().design);
    if (blocked) return blocked;
    if (format === "gcode") {
        return { ok: false, reason: "Use Generate + Export G-code in the Printing tab" };
    }
    if (format === "glb") {
        return exportGlb(side);
    }
    if (format === "3mf") {
        return export3mf(side);
    }
    const { design } = useDesignStore.getState();
    const afoExport = design.productType === "afo";
    const sides = afoExport ? [side] : orderDownloadSides(design);
    const filename = userExportFilename({ sides: sides.length > 1 ? sides : side, ext: "stl" });
    try {
        const stl =
            sides.length > 1
                ? await buildOrderPairStl()
                : await buildExportStl(side, { exportMode: exportModeFromMethod(design.method) });
        if (!stl?.byteLength) {
            return { ok: false, reason: "Export failed" };
        }
        const blob = new Blob([stl], { type: "model/stl" });
        downloadBlob(blob, filename);
        console.log("[EXPORT] token deducted after download");
        const auth = await authorize("stl", side, filename);
        if (!auth.ok) return { ok: false, reason: auth.reason };
        recordExport(`STL ${side} (-${TOKEN_COST.stl})`);
        const warning =
            effectiveHardnessRegions(design, side).length > 0 ? STL_SHELL_ONLY_WARNING : undefined;
        return { ok: true, filename, blob, warning };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "Export failed" };
    }
}

function translateMesh(mesh: TriangleMesh, dy: number): TriangleMesh {
    if (dy === 0) return mesh;
    const positions = new Float32Array(mesh.positions);
    for (let i = 1; i < positions.length; i += 3) positions[i] += dy;
    return { positions, indices: mesh.indices };
}

function assertHardnessMapped(design: DesignState, side: Side): void {
    const unmapped: string[] = [];
    for (const region of effectiveHardnessRegions(design, side)) {
        try {
            classDensityPct(region.hardnessClass, region.overrides);
        } catch (err) {
            unmapped.push(
                `unmapped region ${region.regionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
    if (unmapped.length > 0) {
        throw new Error(`Hardness 3MF export failed: ${unmapped.join("; ")}`);
    }
}

/** One foot, local frame. Same closed solid as the STL download. */
export async function packOne3mf(
    design: DesignState,
    side: Side,
): Promise<{ bytes: Uint8Array; report: HardnessExportReport }> {
    const stl = await buildExportStl(side);
    return exportHardness3mf({ design, side, shell: parseBinaryStl(stl) });
}

/**
 * Every foot on the order in one 3MF. The right foot (and its modifier meshes)
 * shifts +Y by the shoe width plus the viewer gap, matching the pair STL.
 */
export async function packOrder3mf(
    design: DesignState,
    sides: Side[],
): Promise<{ bytes: Uint8Array; report: HardnessExportReport }> {
    const layout = insoleLayoutFromDesign(design);
    const gap = layout.widthMm + 30;
    const built: Array<{
        side: Side;
        shell: TriangleMesh;
        modifiers: ResolvedModifier[];
        requested: ReturnType<typeof buildRawModifiers>["requested"];
    }> = [];
    const t0 = Date.now();
    for (const foot of sides) {
        assertHardnessMapped(design, foot);
        const stl = await buildExportStl(foot);
        let shell = parseBinaryStl(stl);
        const { requested, raw } = buildRawModifiers(design, foot);
        let modifiers = await resolveModifiers(raw);
        const dy = foot === "right" && sides.length > 1 ? gap : 0;
        if (dy) {
            shell = translateMesh(shell, dy);
            modifiers = modifiers.map((m) => ({ ...m, mesh: translateMesh(m.mesh, dy) }));
        }
        built.push({ side: foot, shell, modifiers, requested });
    }
    const first = built[0];
    if (!first) throw new Error("3MF export failed: no feet on the order");
    const rest = built.slice(1);
    const packed = await packHardness3mf({
        design,
        side: first.side,
        shell: first.shell,
        modifiers: first.modifiers,
        extraShells: rest.map((r) => ({ name: r.side, shell: r.shell, modifiers: r.modifiers })),
    });
    const exportMs = Date.now() - t0;
    const report = buildExportReport(
        built.flatMap((b) => b.requested),
        built.flatMap((b) => b.modifiers),
        { resolveMs: exportMs, exportMs },
    );
    if (!report.ok) {
        throw new Error(`Hardness 3MF export failed: ${report.errors.join("; ")}`);
    }
    return { bytes: packed.bytes, report };
}

export async function export3mf(side: Side): Promise<ExportOutcome> {
    const blocked = refuseMilledPrint(useDesignStore.getState().design);
    if (blocked) return blocked;
    const { user, license, deductTokens } = useAuthStore.getState();
    const check = canExport(user, license, "3mf");
    if (!check.ok) return { ok: false, reason: check.reason };
    const { design } = useDesignStore.getState();
    const sides = orderDownloadSides(design);
    const filename = userExportFilename({ sides: sides.length > 1 ? sides : side, ext: "3mf" });
    try {
        const packed = sides.length > 1 ? await packOrder3mf(design, sides) : await packOne3mf(design, side);
        const blob = new Blob([packed.bytes], { type: "model/3mf" });
        downloadBlob(blob, filename);
        deductTokens(TOKEN_COST["3mf"]);
        recordExport(`3MF ${side} (-${TOKEN_COST["3mf"]})`);
        return { ok: true, filename, blob, report: packed.report };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "3MF export failed" };
    }
}

export async function exportGlb(side: Side): Promise<ExportOutcome> {
    const blocked = refuseMilledPrint(useDesignStore.getState().design);
    if (blocked) return blocked;
    const { user, license } = useAuthStore.getState();
    const check = canExport(user, license, "glb");
    if (!check.ok) return { ok: false, reason: check.reason };
    const filename = userExportFilename({ sides: side, ext: "glb" });
    try {
        const arrayBuffer = await buildExportGlb(side);
        const blob = new Blob([arrayBuffer], { type: "model/gltf-binary" });
        downloadBlob(blob, filename);
        recordExport(`GLB ${side}`);
        return { ok: true, filename, blob };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "GLB export failed" };
    }
}

export async function exportCncGcode(sides: Side[], profile: MillingProfile): Promise<ExportOutcome> {
    const { design } = useDesignStore.getState();
    const millSides = cncSidesForOrder(design, sides);
    const before = JSON.stringify(design);
    const cncExt = (profile.fileExtension || ".gcode").replace(/^\./, "");
    const filename = userExportFilename({
        sides: millSides.length > 1 ? millSides : (millSides[0] ?? "left"),
        ext: cncExt,
        material: DEFAULT_APEX_PRINT_MATERIAL_ID,
    });
    try {
        const parts = await workpiecesFromDesign(design, millSides, profile);
        if (parts.length === 0) {
            return { ok: false, reason: "No insole geometry to mill" };
        }
        const placements = useMillingProfileStore.getState().placements;
        const job = generateCncJob(profile, parts, { placements });
        const after = JSON.stringify(useDesignStore.getState().design);
        if (after !== before) {
            return { ok: false, reason: "CNC export mutated design state" };
        }
        const blob = new Blob([job.gcode], { type: "text/plain" });
        downloadBlob(blob, filename);
        const auth = await authorize("gcode", millSides[0] ?? "left", filename);
        if (!auth.ok) return { ok: false, reason: auth.reason };
        recordExport(`CNC G-code ${millSides.join("+")} · ${profile.name}`);
        return {
            ok: true,
            filename,
            blob,
            stats: {
                lines: job.gcode.split("\n").length,
                extrudeDistanceMm: 0,
                travelDistanceMm: job.stats.travelDistanceMm,
                estimatedTimeSec: job.stats.estimatedTimeSec,
                estimatedMaterialMm3: 0,
            },
        };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "CNC export failed" };
    }
}

export const GCODE_EXPORT_STEPS = {
    prepare: "Preparing the insole solid…",
    upload: "Uploading the solid…",
    slice: "Slicing G-code…",
    download: "Downloading G-code…",
} as const;

export type GcodeExportStep = (typeof GCODE_EXPORT_STEPS)[keyof typeof GCODE_EXPORT_STEPS];

export interface HybridGcodeOptions {
    /** @deprecated Shore-A names are not printer materials. Use apexMaterialId. */
    material?: string;
    apexMaterialId?: ApexPrintMaterialId;
    /**
     * AFO shell only. Sends `apex_vylon` on the locked Apex V2 profile.
     * Insole exports leave this unset and keep the Apex Light / Core / Bounce picker.
     */
    afoSliceMaterial?: "apex_vylon";
    /** Default on for belt G-code. Mesh and CNC callers leave this unset. */
    includeLeaderBlock?: boolean;
    onProgress?: (step: string) => void;
    /** Pair export downloads after every foot succeeds. */
    deferDownload?: boolean;
    shouldAbort?: () => boolean;
}

export function hybridGcodeFilename(
    side: Side,
    material: ApexPrintMaterialId | string = DEFAULT_APEX_PRINT_MATERIAL_ID,
): string {
    return userExportFilename({ sides: side, ext: "gcode", material });
}

function exportCancelled(): ExportOutcome {
    return { ok: false, reason: "Export cancelled", cancelled: true };
}

/** Wire fields for one VertexSlice printer G-code job. */
export function printerGcodeSliceFields(apexMaterialId: ApexPrintMaterialId): {
    presetId: string;
    material: VertexSliceMaterialId;
} {
    return {
        presetId: lockedProfileIdForApexMaterial(apexMaterialId),
        material: vertexSliceMaterialForApexMaterial(apexMaterialId),
    };
}

export interface HybridSliceRoute {
    presetId: string;
    material: "apex_vylon" | VertexSliceMaterialId;
    /** Local belt slicer method. AFO is a shell, never the insole solid infill. */
    method: "printing_shell" | "printing_solid";
    /** Local Kiri preset. AFO uses the shell belt, not apex-belt-v2. */
    localPresetId: string;
}

/**
 * AFO G-code uses the ApexVylon shell profile, including when the insole
 * picker still says Apex Core. Send to VertexSlice and the normal export
 * share this route.
 */
export function resolveHybridSlice(
    design: { productType?: string },
    options: { afoSliceMaterial?: "apex_vylon"; apexMaterialId?: ApexPrintMaterialId } = {},
): HybridSliceRoute | null {
    if (design.productType === "afo" || options.afoSliceMaterial === "apex_vylon") {
        const fields = afoShellSliceFields();
        return {
            presetId: fields.presetId,
            material: fields.material,
            method: "printing_shell",
            localPresetId: "apex-belt-v2-shell",
        };
    }
    if (options.apexMaterialId && isApexPrintMaterialExportReady(options.apexMaterialId)) {
        const fields = printerGcodeSliceFields(options.apexMaterialId);
        return {
            presetId: fields.presetId,
            material: fields.material,
            method: "printing_solid",
            localPresetId: "apex-belt-v2",
        };
    }
    return null;
}

/**
 * One foot, in its own frame. This is the only mesh the belt slicer receives.
 * It calls {@link buildExportStl} for `side` and never the Y-shifted pair.
 * The leader is applied once, then a header stamp names the foot. Triangle
 * bytes are the solid plus that one leader.
 */
export async function buildPrinterFootManufacturingStl(
    side: Side,
    includeLeader: boolean,
): Promise<{ stl: ArrayBuffer; solidTriangles: number; uploadTriangles: number }> {
    const solid = await buildExportStl(side, {
        exportMode: exportModeFromMethod(useDesignStore.getState().design.method),
    });
    const solidTriangles = binaryStlTriangleCount(solid);
    const withLeader = manufacturingStlForExportKind(solid, includeLeader ? "gcode" : "stl");
    const uploadTriangles = binaryStlTriangleCount(withLeader);
    if (includeLeader && uploadTriangles <= solidTriangles) {
        throw new Error(`Leader was not applied to the ${side} manufacturing STL`);
    }
    if (!includeLeader && withLeader !== solid) {
        throw new Error(`Leader was applied to a non-G-code ${side} STL`);
    }
    return {
        stl: stampSingleFootStl(withLeader, side),
        solidTriangles,
        uploadTriangles,
    };
}

function yieldToPaint(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Explicit enabled / disabled is a successful check. A missing procedure, a
 * thrown query (network or non-2xx), or a body without a boolean `enabled`
 * is "could not check". Callers with effective regions must stop on that.
 */
async function queryVertexSliceRegional3mf(): Promise<RegionalCapability> {
    const manufacturing = trpc.manufacturing as {
        regional3mfEnabled?: { query: () => Promise<unknown> };
    };
    const query = manufacturing.regional3mfEnabled?.query;
    if (!query) {
        return { state: "unknown", reason: "regional hardness capability check is missing" };
    }
    try {
        return parseRegionalCapability(await query());
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { state: "unknown", reason: reason || "regional hardness capability check failed" };
    }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
}

export async function exportGcode(
    side: Side,
    preset: PrinterPreset,
    overrides: CamOverrides = {},
    options: HybridGcodeOptions = {},
): Promise<ExportOutcome> {
    const { design } = useDesignStore.getState();
    const blocked = refuseMilledPrint(design);
    if (blocked) return blocked;
    options.onProgress?.(GCODE_EXPORT_STEPS.prepare);
    await yieldToPaint();
    const sides = orderDownloadSides(design);
    const filename = userExportFilename({
        sides: sides.length > 1 ? sides : side,
        ext: "gcode",
        material: canonicalExportMaterialName(preset.material),
    });
    const auth = await authorize("gcode", side, filename);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    const geometry = await buildOrderPairGeometry();
    options.onProgress?.(GCODE_EXPORT_STEPS.slice);
    const presetForSlice = options.material ? { ...preset, material: options.material } : preset;
    const { gcode, stats } = generateGcode(geometry, presetForSlice, overrides);
    geometry.dispose();
    const blob = new Blob([gcode], { type: "text/plain" });
    if (!options.deferDownload) downloadBlob(blob, filename);
    recordExport(`G-code ${side} · ${preset.name} (-${TOKEN_COST.gcode})`);
    return { ok: true, filename, blob, stats };
}

/**
 * Server-side hybrid manufacturing: upload the finished viewer STL, then slice (belt) or
 * return validated STL (external printers).
 */
export async function generateHybridGcode(
    side: Side,
    preset: PrinterPreset,
    grindingStyle: GrindingStyleInput,
    overrides: CamOverrides = {},
    options: HybridGcodeOptions = {},
): Promise<ExportOutcome> {
    const blocked = refuseMilledPrint(useDesignStore.getState().design);
    if (blocked) return blocked;
    const report = options.onProgress;
    const abort = (): ExportOutcome | null => (options.shouldAbort?.() ? exportCancelled() : null);
    report?.(GCODE_EXPORT_STEPS.prepare);
    await yieldToPaint();
    const aborted = abort();
    if (aborted) return aborted;
    const activeDesignId = useClientStore.getState().activeDesignId;
    const family = exportMachineFamily({
        method: useDesignStore.getState().design.method,
        beltAngleDeg: preset.beltAngleDeg,
    });
    // Belt: one local-frame STL per foot. Bed printers keep the side-by-side pair STL.
    const separateFiles = pairExportLayout(family) === "separate-files";
    const outputType = separateFiles ? "gcode" : "stl";
    const sliceRoute = resolveHybridSlice(useDesignStore.getState().design, options);
    if (outputType === "gcode" && !sliceRoute) {
        return {
            ok: false,
            reason: "Pick Apex Light, Apex Core, Apex Bounce, or Apex Forge before exporting G-code.",
        };
    }
    const sliceFields = outputType === "gcode" ? sliceRoute : null;
    const ext = outputType === "gcode" ? "gcode" : "stl";
    const exportMaterial =
        options.apexMaterialId ??
        (sliceFields?.material
            ? canonicalExportMaterialName(sliceFields.material)
            : DEFAULT_APEX_PRINT_MATERIAL_ID);
    const filename = userExportFilename({ sides: side, ext, material: exportMaterial });

    if (outputType === "gcode" && !isApiConfigured()) {
        return {
            ok: false,
            reason: "Printer G-code requires the VertexSlice server. Local slicing is disabled so the leader block is not dropped.",
        };
    }

    if (isApiConfigured()) {
        try {
            const includeLeader = separateFiles && options.includeLeaderBlock !== false;
            const stlBuffer = separateFiles
                ? (await buildPrinterFootManufacturingStl(side, includeLeader)).stl
                : await (async () => {
                      const designForStl = useDesignStore.getState().design;
                      const stlSides = orderDownloadSides(designForStl);
                      return stlSides.length > 1
                          ? await buildOrderPairStl()
                          : await buildManufacturingStl(side);
                  })();
            const stopped = abort();
            if (stopped) return stopped;
            const design = useDesignStore.getState().design;
            const effectiveRegions =
                outputType === "gcode" && separateFiles ? effectiveHardnessRegions(design, side) : [];
            let regional3mf: { bytes: ArrayBuffer; regionCount: number } | null = null;
            if (effectiveRegions.length > 0) {
                const decision = regionalSliceDecision({
                    effectiveRegionCount: effectiveRegions.length,
                    capability: await queryVertexSliceRegional3mf(),
                });
                if (decision.action === "fail") throw new Error(decision.message);
                const model = await buildVertexSliceModel({
                    design,
                    side,
                    manufacturingStl: stlBuffer,
                    stlFilename: `${side}.stl`,
                    regional3mfEnabled: true,
                });
                if (model.contentType !== "model/3mf" || model.regionCount < 1) {
                    throw new Error(
                        "Regional hardness was requested but the 3MF has no modifier regions. Refusing a single-density print.",
                    );
                }
                regional3mf = { bytes: bytesToArrayBuffer(model.bytes), regionCount: model.regionCount };
            }
            const stoppedBeforeUpload = abort();
            if (stoppedBeforeUpload) return stoppedBeforeUpload;
            report?.(GCODE_EXPORT_STEPS.upload);
            const stlStorageKey = await uploadManufacturingStlDirect(side, stlBuffer);
            const regional3mfStorageKey = regional3mf
                ? await uploadManufacturingStlDirect(side, regional3mf.bytes, "model/3mf")
                : undefined;
            const stoppedAfterUpload = abort();
            if (stoppedAfterUpload) return stoppedAfterUpload;

            const presetId = sliceFields?.presetId ?? preset.id;
            const printRecipe = bindPrintRecipeProfile(design.printRecipe, presetId);

            report?.(GCODE_EXPORT_STEPS.slice);
            const res = await trpc.manufacturing.generateSolid.mutate({
                designId: activeDesignId || undefined,
                side,
                presetId,
                stlStorageKey,
                outputType,
                beltAngleDeg: preset.beltAngleDeg ?? 45,
                layerHeightMm: outputType === "gcode" ? undefined : overrides.layerHeightMm,
                printRecipe,
                perimeters: outputType === "gcode" ? undefined : overrides.perimeters,
                grindingStyle,
                fileName: filename,
                ...(sliceFields ? { material: sliceFields.material } : {}),
                ...(regional3mf && regional3mfStorageKey
                    ? { regional3mfStorageKey, expectedRegionCount: regional3mf.regionCount }
                    : {}),
            });

            if (!res?.ok) {
                return { ok: false, reason: "Server manufacturing request failed" };
            }
            applyServerBalance(res.balance);

            let blob: Blob | undefined;
            const downloadUrl = res.downloadUrl ?? res.gcodeDownloadUrl;

            const stoppedBeforeDownload = abort();
            if (stoppedBeforeDownload) return stoppedBeforeDownload;
            report?.(GCODE_EXPORT_STEPS.download);
            if (downloadUrl) {
                const resp = await fetch(downloadUrl);
                if (!resp.ok) throw new Error(`Download failed with status ${resp.status}`);
                const data = await resp.arrayBuffer();
                const mime = outputType === "gcode" ? "text/plain" : "model/stl";
                blob = new Blob([data], { type: mime });
            } else if (outputType === "gcode" && res.gcode) {
                blob = new Blob([res.gcode], { type: "text/plain" });
            } else if (outputType === "stl" && res.stlBase64) {
                const bytes = Uint8Array.from(atob(res.stlBase64), (c) => c.charCodeAt(0));
                blob = new Blob([bytes], { type: "model/stl" });
            } else {
                return { ok: false, reason: "Server did not return a downloadable output file" };
            }
            if (!options.deferDownload) downloadBlob(blob, filename);

            recordExport(
                `Hybrid ${outputType.toUpperCase()} ${side} · ${preset.name} (${grindingStyle.type}) (productionId=${res.productionId || "n/a"})`,
            );

            return { ok: true, filename, blob, productionId: res.productionId ?? undefined };
        } catch (e) {
            const raw = e instanceof Error ? e.message : "Hybrid manufacturing failed (server)";
            return {
                ok: false,
                reason: mapClientRpcError(raw, "Hybrid manufacturing failed (server)"),
            };
        }
    }

    if (outputType === "gcode") {
        return {
            ok: false,
            reason: "Printer G-code requires the VertexSlice server. Local slicing is disabled so the leader block is not dropped.",
        };
    }
    return exportDesign("stl", side);
}

export async function downloadGcodeByProductionId(productionId: string): Promise<ExportOutcome> {
    if (!isApiConfigured()) {
        return { ok: false, reason: "API not configured; server G-code download requires backend" };
    }
    try {
        const res = await trpc.manufacturing.getGcodeDownloadUrl.query({ productionId });
        if (!res?.downloadUrl) {
            return { ok: false, reason: "No download URL returned for production" };
        }
        const textResp = await fetch(res.downloadUrl);
        if (!textResp.ok) {
            throw new Error(`Failed to fetch G-code (status ${textResp.status})`);
        }
        const gcodeText = await textResp.text();
        const { design } = useDesignStore.getState();
        const feet = orderDownloadSides(design);
        const filename = userExportFilename({
            sides: feet.length === 1 ? (feet[0] ?? "left") : "left",
            ext: "gcode",
        });
        const blob = new Blob([gcodeText], { type: "text/plain" });
        downloadBlob(blob, filename);
        recordExport(`Hybrid G-code re-download via productionId ${productionId}`);
        return { ok: true, filename, blob, productionId };
    } catch (e) {
        return {
            ok: false,
            reason: e instanceof Error ? e.message : "G-code download by productionId failed",
        };
    }
}
