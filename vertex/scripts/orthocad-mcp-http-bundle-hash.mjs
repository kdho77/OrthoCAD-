import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Hash of packages/mcp/src so a committed HTTP bundle cannot drift from the source. */
export function orthocadMcpHttpSourceHash() {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const dir = resolve(root, "packages/mcp/src");
    const files = readdirSync(dir)
        .filter((name) => name.endsWith(".ts"))
        .sort();
    const hash = createHash("sha256");
    for (const name of files) {
        hash.update(name);
        hash.update("\0");
        hash.update(readFileSync(resolve(dir, name)));
        hash.update("\0");
    }
    return hash.digest("hex");
}
