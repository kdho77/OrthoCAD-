// Frozen before grading candidate f059edf74b9bed33071a4deb8ad3c9674d289dfd.
// Numeric contracts for export-parallel-workers. Do not edit after the freeze commit.

/** Vertex positions must match within this many millimetres. 0.0 means exact. */
export const VERTEX_DELTA_MM = 0.0;

/** Closed insole solids are spheres topologically. */
export const EULER_CHARACTERISTIC = 2;

/** Dorsal band: vertices within this distance of the mesh max Z. */
export const TOP_BAND_MM = 1.0;

/** Plantar/belt band: vertices within this distance of the mesh min Z. */
export const SOLE_BAND_MM = 0.5;

/** A 2-foot cold export uses at least this many distinct worker instances. */
export const MIN_WORKER_INSTANCES = 2;

/** Peak number of workers that hold a solid-build message at the same time. */
export const MIN_PEAK_BUSY_WORKERS = 2;

/** Each cold foot posts at least this many solid-build messages. */
export const MIN_WORKER_POSTS_PER_COLD_FOOT = 1;

/** Headless fallback and warm cache hits construct no workers. */
export const MAX_FALLBACK_WORKER_CONSTRUCTS = 0;

/** Warm second export posts no additional solid builds. */
export const MAX_WARM_EXTRA_POSTS = 0;

/** Independent manifold weld, same quant as vertex/src/lib/geometry/manifold.ts. */
export const MANIFOLD_QUANT = 1e4;

export const EXISTING_TEST_FILES = [
    "vertex/src/lib/geometry/procedural-wall/manufacturing-solid-cache.test.ts",
    "vertex/src/features/exports/export-panel-clinical.test.ts",
    "vertex/src/features/exports/pair-gcode-isolation.test.ts",
    "vertex/src/lib/geometry/procedural-wall/preview-loft-worker.test.ts",
    "vertex/src/lib/geometry/procedural-wall/export-solid.test.ts",
    "vertex/src/lib/geometry/procedural-wall/print-export-cache-parity.test.ts",
];
