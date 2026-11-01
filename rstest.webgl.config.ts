import { defineConfig, type RstestConfig } from "@rstest/core";
import unitConfig from "./rstest.config";

const config = unitConfig as RstestConfig;

/** Same runner as the unit job, but the Playwright pressure-map test is included. */
export default defineConfig({
    ...config,
    exclude: (config.exclude ?? []).filter((pattern) => !String(pattern).includes("pressure-map.webgl")),
});
