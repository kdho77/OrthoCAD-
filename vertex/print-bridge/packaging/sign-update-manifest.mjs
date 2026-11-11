#!/usr/bin/env node

// Sign an update manifest with the private key path in ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE.
// The key is not printed. Missing key means the manifest is not signed.

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const keyFile = process.env.ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE?.trim() ?? "";
const manifestPath = resolve(process.argv[2] ?? "print-bridge/packaging/dist/update-manifest.json");
if (!keyFile) {
    console.log(
        "Update manifest signing skipped. Set ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE when the release key is available.",
    );
    process.exit(0);
}
const payload = JSON.parse(readFileSync(manifestPath, "utf8"));
const body = payload.payload ?? payload;
const canonical = JSON.stringify(sortValue(body));
const key = createPrivateKey(readFileSync(keyFile));
const signature = sign(null, Buffer.from(canonical), key).toString("base64");
writeFileSync(
    manifestPath,
    JSON.stringify(
        {
            keyId: process.env.ORTHOCAD_BRIDGE_UPDATE_KEY_ID?.trim() || "orthocad-print-bridge",
            payload: body,
            signature,
        },
        null,
        2,
    ),
);
console.log(`Signed ${manifestPath}`);

function sortValue(value) {
    if (Array.isArray(value)) return value.map((item) => sortValue(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
        Object.entries(value)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, item]) => [key, sortValue(item)]),
    );
}
