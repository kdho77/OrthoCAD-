import { spawnSync } from "node:child_process";
import { expect, test } from "@rstest/core";

import { REPO_ROOT } from "./harness";
import { EXISTING_TEST_FILES } from "./thresholds";

function redact(text: string): string {
    return text
        .split("\n")
        .filter((line) => !/api[_-]?key|bearer|token/i.test(line))
        .join("\n");
}

test("pass-on-base EXISTING-TESTS hardness, snapshot, anatomical-side, and slice-request tests", () => {
    const result = spawnSync("npx", ["rstest", "--config", "rstest.config.ts", ...EXISTING_TEST_FILES], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 600_000,
        env: { ...process.env, MORTONS_GATES_WRITE_BASELINE: "" },
    });
    const output = redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).slice(-4000);
    expect(result.status, output).toBe(0);
}, 600_000);
