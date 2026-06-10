// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// tsx does not auto-load .env files; this module must be imported before context.ts
// (which reads DATABASE_URL at module init). Vercel/Render inject env at runtime —
// dotenv never overrides existing variables, so production behavior is unchanged.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vertexRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

try {
    require("dotenv").config({ path: resolve(vertexRoot, ".env") });
} catch {
    // dotenv is a devDependency; production images that omit it still rely on injected env.
}
