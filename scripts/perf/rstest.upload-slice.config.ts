import { resolve } from "node:path";
import { defineConfig } from "@rstest/core";
import base from "../../rstest.config";

/** Post-solid upload/slice benchmark only. Does not re-run the loft audit. */
export default defineConfig({
    ...base,
    testTimeout: 600_000,
    include: ["scripts/perf/upload-slice-benchmark.test.ts"],
    exclude: [],
    resolve: {
        alias: {
            "@": resolve("vertex/src"),
        },
    },
});
