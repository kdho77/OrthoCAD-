import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeFileTrace } from "../../vertex/node_modules/@vercel/nft/out/index.js";

const VERTEX = fileURLToPath(new URL("../../vertex/", import.meta.url));
const entry = join(VERTEX, "api/trpc/[[...trpc]].ts");

const traced = await nodeFileTrace([entry], {
    base: VERTEX,
    processCwd: VERTEX,
    ts: true,
    conditions: ["import", "node", "default"],
    ignore: ["node_modules/**"],
});

const files = [...traced.fileList].sort();
const interesting = files.filter((file) =>
    /loft-off-thread|loft-worker-pool|finalized-mesh-runner|canonical-export-loft|manufacturing-cad/.test(
        file,
    ),
);
const warnings = [...traced.warnings].slice(0, 12).map((warning) => warning.message);
console.log(
    JSON.stringify(
        {
            fileCount: files.length,
            interesting,
            worker: files.some((file) => file.endsWith("loft-off-thread.mjs")),
            warnings,
        },
        null,
        2,
    ),
);
void existsSync;
void readFileSync;
