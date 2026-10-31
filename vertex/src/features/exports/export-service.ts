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
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { collectHardnessRegions } from "@/lib/hardness/collect";
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
import { classDensityPct } from "../../../shared/print-recipe/hardness-class-table";
import { bindPrintRecipeProfile } from "../../../shared/print-recipe/print-recipe";

// Re-export for convenience in UI components
export type GrindingStyleInput = GrindingStyle;

export interface ExportOutcome {
    ok: boolean;
    reason?: string;
    filename?: string;
    blob?: Blob;
    stats?: CamResult["stats"];
    productionId?: string;
    warning?: string;
    report?: HardnessExportReport;
}

function applyServerBalance(balance: number | undefined): void {
    if (typeof balance !== "number") return;
    const { user, setUser } = useAuthStore.getState();
    if (user) setUser({ ...user, tokenBalance: balance });
}

async function uploadManufacturingStlDirect(side: Side, stlBuffer: ArrayBuffer): Promise<string> {
    const prep = await trpc.manufacturing.prepareManufacturingStlUpload.mutate({
        side,
        fileName: `manufacturing-${side}.stl`,
    });
    const putHeaders: Record<string, string> = { "Content-Type": "model/stl" };
    if (prep.token) putHeaders.Authorization = `Bearer ${prep.token}`;
    const putRes = await fetch(prep.uploadUrl, {
        method: "PUT",
        headers: putHeaders,
        body: stlBuffer,
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
    const sides = orderDownloadSides(design);
    const filename = `insole-${sides.join("-")}-${Date.now()}.stl`;
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
        useAuditStore.getState().record("export_generated", `STL ${side} (-${TOKEN_COST.stl})`);
        const warning = collectHardnessRegions(design, side).length > 0 ? STL_SHELL_ONLY_WARNING : undefined;
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
    for (const region of collectHardnessRegions(design, side)) {
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
    const { user, license, deductTokens } = useAuthStore.getState();
    const check = canExport(user, license, "3mf");
    if (!check.ok) return { ok: false, reason: check.reason };
    const { design } = useDesignStore.getState();
    const sides = orderDownloadSides(design);
    const filename = `insole-${sides.join("-")}-${Date.now()}.3mf`;
    try {
        const packed = sides.length > 1 ? await packOrder3mf(design, sides) : await packOne3mf(design, side);
        const blob = new Blob([packed.bytes], { type: "model/3mf" });
        downloadBlob(blob, filename);
        deductTokens(TOKEN_COST["3mf"]);
        useAuditStore.getState().record("export_generated", `3MF ${side} (-${TOKEN_COST["3mf"]})`);
        return { ok: true, filename, blob, report: packed.report };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "3MF export failed" };
    }
}

export async function exportGlb(side: Side): Promise<ExportOutcome> {
    const { user, license } = useAuthStore.getState();
    const check = canExport(user, license, "glb");
    if (!check.ok) return { ok: false, reason: check.reason };
    const filename = `insole-${side}-${Date.now()}.glb`;
    try {
        const arrayBuffer = await buildExportGlb(side);
        const blob = new Blob([arrayBuffer], { type: "model/gltf-binary" });
        downloadBlob(blob, filename);
        useAuditStore.getState().record("export_generated", `GLB ${side}`);
        return { ok: true, filename, blob };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "GLB export failed" };
    }
}

export async function exportCncGcode(sides: Side[], profile: MillingProfile): Promise<ExportOutcome> {
    const { design } = useDesignStore.getState();
    const before = JSON.stringify(design);
    const filename = `insole-cnc-${sides.join("-")}-${Date.now()}${profile.fileExtension || ".gcode"}`;
    try {
        const parts = await workpiecesFromDesign(design, sides, profile);
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
        const auth = await authorize("gcode", sides[0] ?? "left", filename);
        if (!auth.ok) return { ok: false, reason: auth.reason };
        useAuditStore
            .getState()
            .record("export_generated", `CNC G-code ${sides.join("+")} · ${profile.name}`);
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

export async function exportGcode(
    side: Side,
    preset: PrinterPreset,
    overrides: CamOverrides = {},
): Promise<ExportOutcome> {
    const { design } = useDesignStore.getState();
    const sides = orderDownloadSides(design);
    const filename = `insole-${sides.join("-")}-${preset.id}-${Date.now()}.gcode`;
    const auth = await authorize("gcode", side, filename);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    const geometry = await buildOrderPairGeometry();
    const { gcode, stats } = generateGcode(geometry, preset, overrides);
    geometry.dispose();
    const blob = new Blob([gcode], { type: "text/plain" });
    downloadBlob(blob, filename);
    useAuditStore
        .getState()
        .record("export_generated", `G-code ${side} · ${preset.name} (-${TOKEN_COST.gcode})`);
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
): Promise<ExportOutcome> {
    const activeDesignId = useClientStore.getState().activeDesignId;
    const outputType = preset.beltAngleDeg ? "gcode" : "stl";
    const ext = outputType === "gcode" ? "gcode" : "stl";
    const filename = `hybrid-${side}-${preset.id}-${Date.now()}.${ext}`;

    if (isApiConfigured()) {
        try {
            const designForStl = useDesignStore.getState().design;
            const stlSides = orderDownloadSides(designForStl);
            const stlBuffer =
                stlSides.length > 1 ? await buildOrderPairStl() : await buildManufacturingStl(side);
            const stlStorageKey = await uploadManufacturingStlDirect(side, stlBuffer);

            const design = useDesignStore.getState().design;
            const printRecipe = bindPrintRecipeProfile(design.printRecipe, preset.id);

            const res = await trpc.manufacturing.generateSolid.mutate({
                designId: activeDesignId || undefined,
                side,
                presetId: preset.id,
                stlStorageKey,
                outputType,
                beltAngleDeg: preset.beltAngleDeg ?? 45,
                layerHeightMm: overrides.layerHeightMm,
                printRecipe,
                perimeters: overrides.perimeters,
                grindingStyle,
                fileName: filename,
            });

            if (!res?.ok) {
                return { ok: false, reason: "Server manufacturing request failed" };
            }
            applyServerBalance(res.balance);

            let blob: Blob | undefined;
            const downloadUrl = res.downloadUrl ?? res.gcodeDownloadUrl;

            if (downloadUrl) {
                const resp = await fetch(downloadUrl);
                if (!resp.ok) throw new Error(`Download failed with status ${resp.status}`);
                const data = await resp.arrayBuffer();
                const mime = outputType === "gcode" ? "text/plain" : "model/stl";
                blob = new Blob([data], { type: mime });
                downloadBlob(blob, filename);
            } else if (outputType === "gcode" && res.gcode) {
                blob = new Blob([res.gcode], { type: "text/plain" });
                downloadBlob(blob, filename);
            } else if (outputType === "stl" && res.stlBase64) {
                const bytes = Uint8Array.from(atob(res.stlBase64), (c) => c.charCodeAt(0));
                blob = new Blob([bytes], { type: "model/stl" });
                downloadBlob(blob, filename);
            } else {
                return { ok: false, reason: "Server did not return a downloadable output file" };
            }

            useAuditStore
                .getState()
                .record(
                    "export_generated",
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

    // Offline fallback — client-side G-code only
    if (outputType === "gcode") {
        return exportGcode(side, preset, overrides);
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
        const filename = `hybrid-${productionId}.gcode`;
        const blob = new Blob([gcodeText], { type: "text/plain" });
        downloadBlob(blob, filename);
        useAuditStore
            .getState()
            .record("export_generated", `Hybrid G-code re-download via productionId ${productionId}`);
        return { ok: true, filename, blob, productionId };
    } catch (e) {
        return {
            ok: false,
            reason: e instanceof Error ? e.message : "G-code download by productionId failed",
        };
    }
}
