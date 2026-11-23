// Diff rules for R1–R7, MUST-MATCH, and ONE. Pure: no product imports.
// A path is in scope only when it is the sink cut, a sink test, or the
// unit-test shard list. Everything else fails the scope gate.

export interface DiffEntry {
    status: string;
    path: string;
}

export interface ClassifiedDiff {
    files: DiffEntry[];
    /** Paths that are not the sink cut, a sink test, or the shard list. */
    outOfScope: string[];
    seamOrSlicer: string[];
    textMarking: string[];
    railwayOrDeploy: string[];
    stockMesh: string[];
}

const SEAM_OR_SLICER = [
    /seam/i,
    /slicer/i,
    /slice-mesh/i,
    /vertexslice/i,
    /\/kiri\//i,
    /belt_wall_slice/i,
    /surface-quality/i,
    /layer-change/i,
];

const TEXT_MARKING = [/text-marking/i, /textMarking/i];

const RAILWAY_OR_DEPLOY = [
    /railway/i,
    /vertex-web/i,
    /vertex-api/i,
    /(^|\/)\.github\/workflows\//,
    /deploy/i,
];

const STOCK_MESH = [/SAMPLE_Top\.glb$/i, /Default\.glb$/i, /\.(stl|obj)$/i];

export function isAllowedSinkPath(path: string): boolean {
    const p = path.replace(/\\/g, "/");
    if (p === "ci/unit-test-shards.json") return true;
    return /sink/i.test(p);
}

export function classifyDiff(entries: DiffEntry[]): ClassifiedDiff {
    const out: ClassifiedDiff = {
        files: entries,
        outOfScope: [],
        seamOrSlicer: [],
        textMarking: [],
        railwayOrDeploy: [],
        stockMesh: [],
    };
    for (const entry of entries) {
        const p = entry.path.replace(/\\/g, "/");
        if (!isAllowedSinkPath(p)) out.outOfScope.push(p);
        if (SEAM_OR_SLICER.some((re) => re.test(p))) out.seamOrSlicer.push(p);
        if (TEXT_MARKING.some((re) => re.test(p))) out.textMarking.push(p);
        if (RAILWAY_OR_DEPLOY.some((re) => re.test(p))) out.railwayOrDeploy.push(p);
        if (STOCK_MESH.some((re) => re.test(p)) || (/\.glb$/i.test(p) && !/sink/i.test(p))) {
            out.stockMesh.push(p);
        }
    }
    return out;
}

/** `git diff --name-status` lines. Rename records keep the destination path. */
export function parseNameStatus(text: string): DiffEntry[] {
    const out: DiffEntry[] = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split("\t");
        const status = parts[0] ?? "";
        const path = parts[parts.length - 1] ?? "";
        if (path) out.push({ status, path });
    }
    return out;
}
