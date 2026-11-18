import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const targetDir = join(pkgRoot, "src", "shared");
const target = join(targetDir, "export-filename.ts");
const source = join(pkgRoot, "..", "..", "vertex", "shared", "export-filename.ts");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
