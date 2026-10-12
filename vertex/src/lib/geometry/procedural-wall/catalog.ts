// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

export interface StockBaseFixture {
    id: string;
    name: string;
    path: string;
}

const FIXTURE_DIR = resolve(process.cwd(), "tests/fixtures");

/**
 * Every stock-base GLB checked into the repo (currently Default.glb; the
 * catalog auto-picks up any additional `*.glb` dropped in tests/fixtures).
 */
export function listStockBaseFixtures(): StockBaseFixture[] {
    const found: StockBaseFixture[] = [];
    if (existsSync(FIXTURE_DIR)) {
        for (const file of readdirSync(FIXTURE_DIR).sort()) {
            if (!/\.glb$/i.test(file)) continue;
            if (/^SAMPLE_/i.test(file)) continue;
            const id = basename(file, ".glb")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-");
            found.push({
                id,
                name: basename(file, ".glb"),
                path: resolve(FIXTURE_DIR, file),
            });
        }
    }
    if (found.length === 0) {
        found.push({
            id: "default",
            name: "Default",
            path: resolve(process.cwd(), "tests/fixtures/Default.glb"),
        });
    }
    return found;
}
