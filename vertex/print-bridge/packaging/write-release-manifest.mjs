#!/usr/bin/env node
// Write an unsigned update manifest from the release files. A private key is not read here.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "release-assets";
const names = {
    "win32-x64": "OrthoCAD-Print-Bridge-Setup.exe",
    "darwin-arm64": "OrthoCAD-Print-Bridge.pkg",
    "darwin-x64": "OrthoCAD-Print-Bridge.pkg",
};
const platforms = {};
for (const [platform, name] of Object.entries(names)) {
    const bytes = readFileSync(join(dir, name));
    platforms[platform] = {
        url: `https://github.com/kdho77/OrthoCAD-/releases/latest/download/${name}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
    };
}
const releasedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
writeFileSync(
    join(dir, "update-manifest.json"),
    `${JSON.stringify(
        {
            product: "orthocad-print-bridge",
            channel: "stable",
            version: process.env.PRINT_BRIDGE_RELEASE_VERSION || "2026.11.10.1",
            minVersion: "2026.11.09.0",
            releasedAt,
            expiresAt,
            platforms,
        },
        null,
        2,
    )}\n`,
);
console.log(`Wrote ${join(dir, "update-manifest.json")}`);
