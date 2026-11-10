// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { config } from "../../api/print-bridge/index";

function matches(source: string, path: string): boolean {
    if (source.startsWith("/((")) {
        return new RegExp(`^${source.slice(1)}$`).test(path.slice(1));
    }
    if (source.endsWith("/:path*")) {
        const prefix = source.slice(0, -"/:path*".length);
        return path.startsWith(`${prefix}/`);
    }
    return path === source;
}

function destination(rewrites: { source: string; destination: string }[], path: string): string | null {
    for (const rewrite of rewrites) {
        if (matches(rewrite.source, path)) return rewrite.destination;
    }
    return null;
}

describe("print-bridge vercel rewrites", () => {
    test("routes the bridge function and leaves the existing routes in place", () => {
        const vercel = JSON.parse(readFileSync("vertex/vercel.json", "utf8")) as {
            rewrites: { source: string; destination: string }[];
        };
        expect(vercel.rewrites).toEqual([
            { source: "/trpc", destination: "/api/trpc" },
            { source: "/trpc/:path*", destination: "/api/trpc/:path*" },
            { source: "/api/integrations/:path*", destination: "/api/integrations" },
            { source: "/print-bridge/:path*", destination: "/api/print-bridge" },
            {
                source: "/((?!api/|trpc/|elements/|Templates/|print-bridge/).*)",
                destination: "/index.html",
            },
        ]);
        expect(destination(vercel.rewrites, "/print-bridge/v1/heartbeat")).toBe("/api/print-bridge");
        expect(destination(vercel.rewrites, "/print-bridge/v1/heartbeat")).not.toBe("/index.html");
        expect(destination(vercel.rewrites, "/trpc")).toBe("/api/trpc");
        expect(destination(vercel.rewrites, "/trpc/production.list")).toBe("/api/trpc/:path*");
        expect(destination(vercel.rewrites, "/api/integrations/v1/clients/upsert")).toBe("/api/integrations");
        expect(destination(vercel.rewrites, "/production/printers")).toBe("/index.html");
        expect(destination(vercel.rewrites, "/")).toBe("/index.html");
        expect(destination(vercel.rewrites, "/elements/arch")).toBeNull();
        expect(destination(vercel.rewrites, "/Templates/shell")).toBeNull();
        expect(destination(vercel.rewrites, "/api/trpc")).toBeNull();
        expect(config.api.bodyParser).toBe(false);
        expect(config.maxDuration).toBe(60);
        const entries = readdirSync("vertex/api/print-bridge").filter((name) => !name.startsWith("."));
        expect(entries).toEqual(["index.ts"]);
        expect(JSON.stringify(vercel)).not.toContain(".test.ts");
        const node = readFileSync("vertex/server/src/index.ts", "utf8");
        expect(node).toContain('"/print-bridge/"');
        expect(node).toContain("handlePrintBridgeNode");
        expect(node).toContain("bridge store is not configured");
    });
});
