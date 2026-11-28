import { createRequire } from "node:module";
import { stripTypeScriptTypes } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(new URL("./package.json", import.meta.url));
const zodUrl = pathToFileURL(require.resolve("zod")).href;
const stubDir = fileURLToPath(new URL("./stubs/", import.meta.url));

function stubUrl(name) {
    return pathToFileURL(path.join(stubDir, name)).href;
}

function isPrintRecipe(specifier) {
    return specifier.includes("print-recipe.js") || specifier.includes("print-recipe.ts");
}

function isVertexSlice(specifier) {
    return specifier.includes("vertexslice-client.js") || specifier.includes("vertexslice-client.ts");
}

export async function resolve(specifier, context, nextResolve) {
    if (specifier === "zod") {
        return { url: zodUrl, shortCircuit: true };
    }
    if (specifier === "@trpc/server") {
        return { url: stubUrl("trpc-server.mjs"), shortCircuit: true };
    }
    if (specifier === "@vercel/functions") {
        return { url: stubUrl("vercel-functions.mjs"), shortCircuit: true };
    }
    if (isPrintRecipe(specifier)) {
        return { url: stubUrl("print-recipe.mjs"), shortCircuit: true };
    }
    if (isVertexSlice(specifier)) {
        return { url: stubUrl("vertexslice-client.mjs"), shortCircuit: true };
    }
    if (specifier.startsWith(".")) {
        const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
        let abs = path.resolve(path.dirname(parent), specifier);
        if (abs.endsWith(".js") && !existsSync(abs)) {
            const ts = `${abs.slice(0, -3)}.ts`;
            if (existsSync(ts)) abs = ts;
        }
        return { url: pathToFileURL(abs).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    if (url.startsWith("file:") && (url.endsWith(".ts") || url.endsWith(".tsx"))) {
        const source = readFileSync(fileURLToPath(url), "utf8");
        const stripped = stripTypeScriptTypes(source, { sourceUrl: url });
        return { format: "module", source: stripped, shortCircuit: true };
    }
    return nextLoad(url, context);
}
