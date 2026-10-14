// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FileReader } from "happy-dom";
import { SphereGeometry } from "three";

(globalThis as { FileReader?: typeof FileReader }).FileReader = FileReader;

import { exportObjectToGlb, meshFromGeometry } from "../src/lib/geometry/glb-export";

/** ~20×20 mm footprint hemisphere, 5 mm peak, Z-up, origin at footprint centre. */
async function main(): Promise<void> {
    const dome = new SphereGeometry(10, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const mesh = meshFromGeometry(dome, "#6b7280");
    dome.dispose();
    const { arrayBuffer } = await exportObjectToGlb(mesh);
    const out = resolve(process.cwd(), "vertex/public/elements/synthetic-dome.glb");
    writeFileSync(out, Buffer.from(arrayBuffer));
    console.log(`Wrote ${out} (${arrayBuffer.byteLength} bytes)`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
