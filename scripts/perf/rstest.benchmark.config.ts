import { resolve } from "node:path";
import { DefinePlugin } from "@rspack/core";
import { defineConfig } from "@rstest/core";
import base from "../../rstest.config";

export default defineConfig({
    ...base,
    testTimeout: 600_000,
    include: ["scripts/perf/load-and-export-benchmark.test.ts"],
    exclude: [],
    tools: {
        rspack: {
            ...(base.tools?.rspack ?? {}),
            plugins: [
                ...(base.tools?.rspack?.plugins ?? []),
                new DefinePlugin({
                    __BENCHMARK_JSON__: JSON.stringify(process.env.BENCHMARK_JSON ?? ""),
                }),
            ],
        },
    },
    resolve: {
        alias: {
            "@": resolve("vertex/src"),
        },
    },
});
