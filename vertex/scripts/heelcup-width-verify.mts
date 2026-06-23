/**
 * Phase 2 verification: heel-cup width smoothing metrics on stock GLB.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOCK_URL =
    "https://wstneucimlemaokoyjwh.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb";

if (typeof globalThis.ProgressEvent === "undefined") {
    globalThis.ProgressEvent = class ProgressEvent extends Event {
        lengthComputable: boolean;
        loaded: number;
        total: number;
        constructor(type: string, init?: { lengthComputable?: boolean; loaded?: number; total?: number }) {
            super(type);
            this.lengthComputable = init?.lengthComputable ?? false;
            this.loaded = init?.loaded ?? 0;
            this.total = init?.total ?? 0;
        }
    } as typeof ProgressEvent;
}

async function main() {
    const { loadGlbFromBuffer, extractMergedGeometry } = await import(
        pathToFileURL(resolve(__dirname, "../src/lib/library/loaders.ts")).href
    );
    const { measureHeelCupWidthSmoothing } = await import(
        pathToFileURL(resolve(__dirname, "../src/lib/geometry/base-modifier.ts")).href
    );

    const res = await fetch(STOCK_URL);
    if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const group = await loadGlbFromBuffer(buf);
    const merged = extractMergedGeometry(group, { sealBottomSlits: false });
    if (!merged) throw new Error("extractMergedGeometry returned null");
    const geo = merged.geometry;
    group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
    });

    const field = {
        side: "right" as const,
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

    const unsmoothed = measureHeelCupWidthSmoothing(geo, field, 0);
    const smoothed = measureHeelCupWidthSmoothing(geo, field, 1);
    const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;

    console.log(
        JSON.stringify(
            {
                stockGlb: true,
                topVertexCount: topN,
                widthMm: 8,
                smoothingIterations: 1,
                unsmoothed,
                smoothed,
            },
            null,
            2,
        ),
    );

    geo.dispose();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
