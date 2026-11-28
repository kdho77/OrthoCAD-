// Frozen scope and safety-guard gates. Paths are the Morton's shape change
// and its tests. Shared shell, slicer, hardness, stock mesh, and engraving
// files are out of scope.

export const ALLOWED_PATHS = [
    "ci/unit-test-shards.json",
    "vertex/src/lib/geometry/elements.test.ts",
    "vertex/src/lib/geometry/elements.ts",
    "vertex/src/lib/geometry/mortons-extension.ts",
    "vertex/src/lib/geometry/mortons-shape-gates.test.ts",
] as const;

const DENY_PATTERNS: RegExp[] = [
    /(^|\/)vertex\/src\/lib\/hardness\//,
    /print-recipe/i,
    /slicer/i,
    /infill/i,
    /vertex-web/,
    /vertex-api/,
    /railway/i,
    /SAMPLE_Top/,
    /seam/i,
    /layer-change/i,
    /text-marking/i,
    /engrav/i,
    /printer/i,
];

/** Lines whose deletion is a removed safety guard. */
export const GUARD_SENTINELS = [
    "REMAINING_MATERIAL_MM",
    "softFloor",
    "assertClosedSolidAcceptable",
    "seams and layer changes",
] as const;

export interface ScopeVerdict {
    pass: boolean;
    denied: string[];
    outsideAllowlist: string[];
}

export function scopeVerdict(files: readonly string[]): ScopeVerdict {
    const denied: string[] = [];
    const outsideAllowlist: string[] = [];
    for (const file of files) {
        if (file.startsWith("validation/mortons_shape_gates/")) continue;
        if (DENIED(file)) denied.push(file);
        if (!ALLOWED_PATHS.includes(file as (typeof ALLOWED_PATHS)[number])) outsideAllowlist.push(file);
    }
    return { pass: denied.length === 0 && outsideAllowlist.length === 0, denied, outsideAllowlist };
}

function DENIED(file: string): boolean {
    return DENY_PATTERNS.some((re) => re.test(file));
}

export interface GuardVerdict {
    pass: boolean;
    removed: string[];
}

/** `diffText` is a unified diff. A removed sentinel line fails the guard. */
export function guardVerdict(diffText: string): GuardVerdict {
    const removed: string[] = [];
    for (const line of diffText.split("\n")) {
        if (!line.startsWith("-") || line.startsWith("---")) continue;
        for (const sentinel of GUARD_SENTINELS) {
            if (line.includes(sentinel)) removed.push(sentinel);
        }
    }
    return { pass: removed.length === 0, removed: [...new Set(removed)] };
}
