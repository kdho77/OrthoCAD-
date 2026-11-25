import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Hash of packages/mcp/src, including tools/ and the other subdirectories.
 * A top-level-only hash stayed green after get_production gained wait_s while
 * the committed HTTP bundle still advertised production_id alone.
 */
export function orthocadMcpHttpSourceHash() {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const dir = resolve(root, "packages/mcp/src");
    const files = [];
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = resolve(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".ts")) files.push(full);
        }
    };
    walk(dir);
    files.sort();
    const hash = createHash("sha256");
    for (const full of files) {
        hash.update(relative(dir, full).split("\\").join("/"));
        hash.update("\0");
        hash.update(readFileSync(full));
        hash.update("\0");
    }
    return hash.digest("hex");
}
