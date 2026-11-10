// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// First-run config for the installed bridge. The shop user does not run this.
// It may import an existing credential into the OS store. It does not print secrets.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importExistingInstall } from "./import-existing-install.js";
import { type CommandRunner, createPlatformSecretStore } from "./secret-store.js";

function stateDir(): string {
    if (process.env.ORTHOCAD_BRIDGE_STATE_DIR?.trim()) return process.env.ORTHOCAD_BRIDGE_STATE_DIR.trim();
    if (process.platform === "win32") {
        return join(process.env.PROGRAMDATA || "C:\\ProgramData", "OrthoCAD", "PrintBridge");
    }
    return "/Library/Application Support/OrthoCAD/PrintBridge/state";
}

const runner: CommandRunner = (command, args, input) =>
    new Promise((resolve) => {
        const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        const stdout: Buffer[] = [];
        child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
        child.on("error", () => resolve({ code: 1, stdout: "", stderr: "" }));
        child.on("close", (code) =>
            resolve({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: "" }),
        );
        child.stdin.end(input);
    });

const dir = stateDir();
mkdirSync(dir, { recursive: true });
const configPath = join(dir, "bridge.json");
if (!existsSync(configPath)) {
    const origin = (process.env.ORTHOCAD_BRIDGE_CLOUD_ORIGIN ?? "").trim();
    if (!origin.startsWith("https://") || origin.includes("REPLACE_WITH")) {
        console.error(
            "The installer is missing its OrthoCAD address. Download a current installer from the Printers page.",
        );
        process.exit(1);
    }
    writeFileSync(
        configPath,
        JSON.stringify(
            {
                origin,
                bridgeId: randomUUID(),
                updateManifestUrl: (process.env.ORTHOCAD_BRIDGE_UPDATE_MANIFEST_URL ?? "").trim(),
            },
            null,
            2,
        ),
        { mode: 0o600 },
    );
}

if (process.platform === "win32" || process.platform === "darwin") {
    const store = createPlatformSecretStore({ platform: process.platform, stateDir: dir, run: runner });
    const taskXmlPath = join(dir, "previous-task.xml");
    const taskXml = existsSync(taskXmlPath) ? readFileSync(taskXmlPath, "utf8") : undefined;
    const imported = await importExistingInstall({ stateDir: dir, store, taskXml });
    if (imported?.bridgeId) {
        const current = JSON.parse(readFileSync(configPath, "utf8")) as {
            origin?: string;
            updateManifestUrl?: string;
        };
        writeFileSync(
            configPath,
            JSON.stringify(
                {
                    origin: imported.origin || current.origin,
                    bridgeId: imported.bridgeId,
                    updateManifestUrl: current.updateManifestUrl ?? "",
                },
                null,
                2,
            ),
            { mode: 0o600 },
        );
    }
}

console.error("print bridge config is ready");
