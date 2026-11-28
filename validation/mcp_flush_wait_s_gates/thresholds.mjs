/** Frozen thresholds. Do not edit after the freeze commit. */

export const BASE_SHA = "f759bde1e212ae99d475601fc58dd89dd37469c7";

export const THRESHOLDS = {
    /** generate_gcode pair must return both production ids within this budget. */
    pairReturnBudgetMs: 5000,
    /** Both feet must be invoked and enqueued within this gap. Not a ~138s stagger. */
    pairStartGapBudgetMs: 5000,
    /** Synchronous loft stand-in. Longer than the return budget, far shorter than 75s. */
    loftBlockMs: 6000,
    /** How long the first foot waits to see the other foot start. Sequential enqueue loses. */
    parallelProbeMs: 6000,
    /** Stop an async hang before it can become a 75s-class wait. */
    pairHangCapMs: 20000,
    waitSCap: 300,
    waitSReject: 301,
    zeroFetchMaxMs: 500,
    positiveWaitS: 5,
    positiveWaitMinMs: 3500,
    positiveWaitMaxMs: 15000,
    positiveWaitMinFetches: 2,
};

export const STOCK_LOFT_PATHS = [
    "tests/fixtures/SAMPLE_Top.glb",
    "vertex/public/Templates/SAMPLE_Top.glb",
];

const GATE_PREFIX = "validation/mcp_flush_wait_s_gates/";

export function isGatePath(filePath) {
    const n = filePath.replaceAll("\\", "/");
    return n === GATE_PREFIX.slice(0, -1) || n.startsWith(GATE_PREFIX);
}

/** Geometry, stock mesh bytes, seams, layer-change, and slicer surface files. */
export function isGeometryOrSurfacePath(filePath) {
    const n = filePath.replaceAll("\\", "/");
    if (isGatePath(n)) return false;
    if (/\.(stl|glb|obj|ply|3mf)$/i.test(n)) return true;
    if (n.includes("/geometry/") || n.startsWith("geometry/")) return true;
    if (/seam|layer[-_]?change|surface[-_]?quality|first[-_]?layer/i.test(n)) return true;
    if (n.endsWith("kiri/slicer.ts") || n.endsWith("services/slicer.py")) return true;
    return false;
}

export function displayPath(filePath) {
    const n = filePath.replaceAll("\\", "/");
    if (n.includes("docs/diagnostics/")) return "docs/diagnostics/<redacted-mesh>";
    return n;
}

export function redact(text) {
    return String(text)
        .split("\n")
        .filter((line) => !/api_key|token|bearer/i.test(line))
        .join("\n");
}
