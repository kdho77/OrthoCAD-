/**
 * Load real stock GLB and run applyBaseModifiers width diagnostics (Node).
 */
import { writeFileSync } from "node:fs";
import { loadGlbFromUrl, extractMergedGeometry } from "../src/lib/library/loaders.ts";
import { applyBaseModifiers } from "../src/lib/geometry/base-modifier.ts";
import type { HeightFieldParams } from "../src/lib/geometry/height-field.ts";

const STOCK_URL =
    "https://wstneucimlemaokoyjwh.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb";

const captured: string[] = [];
const origLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
    const text = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
    if (text.includes("[HEELCUP-DIAG]")) captured.push(text);
    origLog(...args);
};

async function main() {
    origLog("Loading stock GLB from", STOCK_URL);
    const group = await loadGlbFromUrl(STOCK_URL);
    const merged = extractMergedGeometry(group, { sealBottomSlits: false });
    if (!merged) throw new Error("extractMergedGeometry returned null");
    const geo = merged.geometry;
    origLog("Mesh:", {
        vertices: geo.getAttribute("position")?.count,
        isMultiMesh: geo.userData?.isMultiMeshBase,
        topVertexCount: geo.userData?.topVertexCount,
    });

    const field: HeightFieldParams = {
        side: "right",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: 3,
        corrections: {
            forefootPostingDeg: 0,
            rearfootPostingDeg: 0,
            medialSkiveMm: 0,
            lateralSkiveMm: 0,
            archFillMm: 0,
            archHeightMm: 0,
            heelCupDepthMm: 0,
            heelCupHeightMm: 0,
            heelCupWidthMm: 8,
            heelLiftMm: 0,
            apexMoveMm: 0,
            medialFlangeMm: 0,
            lateralFlangeMm: 0,
        },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };

    const out = applyBaseModifiers(geo, field, 0);
    out.dispose();
    geo.dispose();

    writeFileSync("/tmp/heelcup-stock-glb-width-diag.json", JSON.stringify(captured, null, 2));
    origLog(`Captured ${captured.length} width diag lines`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
