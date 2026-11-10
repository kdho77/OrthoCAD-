#!/usr/bin/env node
// Syntax-check the installer sources and prove a signed manifest round-trips.
// Does not contact printers and does not require a production certificate.

import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

function read(path) {
    return readFileSync(resolve(here, path), "utf8");
}

const iss = read("windows/orthocad-print-bridge.iss");
for (const needle of ["[Setup]", "[Files]", "[Run]", "runhidden", "OrthoCAD Print Bridge"]) {
    if (!iss.includes(needle)) throw new Error(`Windows installer script is missing ${needle}`);
}
if (/powershell|cmd\.exe|\/c start/i.test(iss)) {
    throw new Error("The Windows installer script must not ask the shop to open a command window.");
}

const plist = read("macos/com.orthocad.print-bridge.plist");
if (!plist.includes("com.orthocad.print-bridge") || !plist.includes("<key>RunAtLoad</key>")) {
    throw new Error("LaunchAgent plist is incomplete.");
}

const dpapi = read("windows/dpapi-store.ps1");
if (!dpapi.includes("ProtectedData") || !dpapi.includes("LocalMachine")) {
    throw new Error("Windows credential helper must use DPAPI.");
}
const swift = read("macos/keychain-store.swift");
if (!swift.includes("SecItemAdd") || !swift.includes("kSecClassGenericPassword")) {
    throw new Error("macOS credential helper must use the Keychain.");
}

for (const script of ["macos/build-pkg.sh", "macos/notarize-macos.sh", "macos/scripts/postinstall"]) {
    const result = spawnSync("bash", ["-n", resolve(here, script)], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${script} failed bash -n: ${result.stderr}`);
}

const build = spawnSync(process.execPath, [resolve(here, "build-payload.mjs")], {
    cwd: root,
    encoding: "utf8",
});
if (build.status !== 0) {
    throw new Error(`payload bundle failed: ${build.stderr || build.stdout}`);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const scratch = resolve(here, "dist");
const keyPath = resolve(scratch, `test-key-${randomBytes(4).toString("hex")}.pem`);
const manifestPath = resolve(scratch, "update-manifest.json");
writeFileSync(
    manifestPath,
    JSON.stringify({
        product: "orthocad-print-bridge",
        channel: "stable",
        version: "2026.11.10.2",
        minVersion: "2026.11.09.0",
        releasedAt: "2026-11-10T00:00:00.000Z",
        expiresAt: "2027-11-10T00:00:00.000Z",
        platforms: {
            "win32-x64": { url: "https://downloads.example/setup.exe", sha256: "ab".repeat(32) },
        },
    }),
);
writeFileSync(keyPath, privatePem, { mode: 0o600 });
const signed = spawnSync(process.execPath, [resolve(here, "sign-update-manifest.mjs"), manifestPath], {
    cwd: root,
    encoding: "utf8",
    env: {
        ...process.env,
        ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE: keyPath,
        ORTHOCAD_BRIDGE_UPDATE_KEY_ID: "ci-test",
    },
});
rmSync(keyPath, { force: true });
if (signed.status !== 0) throw new Error(signed.stderr || signed.stdout);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!manifest.signature || manifest.signature.length < 20) throw new Error("Manifest was not signed.");
if (JSON.stringify(manifest).includes(privatePem)) throw new Error("Private key leaked into the manifest.");
if (!publicPem.includes("BEGIN PUBLIC KEY")) throw new Error("Test public key was not generated.");
console.log(
    "Print bridge packaging checks passed. Windows .exe and macOS .pkg still need a signing machine.",
);
