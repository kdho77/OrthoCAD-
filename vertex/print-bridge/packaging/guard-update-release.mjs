#!/usr/bin/env node
// Refuse a signed release when the committed public key is still a placeholder.
// This process does not print private key material.

import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const keysPath = resolve(process.argv[2] ?? resolve(here, "update-public-keys.json"));
const text = readFileSync(keysPath, "utf8");
const signingKeyPresent = Boolean(
    (process.env.ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY ?? "").trim() ||
        (process.env.ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE ?? "").trim(),
);
const placeholder = text.includes("REPLACE-WITH-PRODUCTION-PUBLIC-KEY");

if (placeholder && signingKeyPresent) {
    console.error(
        "Refusing to publish. update-public-keys.json still contains REPLACE-WITH-PRODUCTION-PUBLIC-KEY while ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY is present. The installed bridge would not trust that signature.",
    );
    process.exit(1);
}

if (!signingKeyPresent) {
    console.log("Update manifest signing skipped. Secret ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY is absent.");
    process.exit(0);
}

const parsed = JSON.parse(text);
const pem = parsed["orthocad-print-bridge"];
if (typeof pem !== "string" || !pem.includes("BEGIN PUBLIC KEY") || pem.includes("REPLACE")) {
    console.error(
        "Refusing to publish. update-public-keys.json is missing a usable orthocad-print-bridge public key.",
    );
    process.exit(1);
}
createPublicKey(pem);
process.exit(0);
