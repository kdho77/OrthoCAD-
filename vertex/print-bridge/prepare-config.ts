// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// First-run config for the installed bridge. The shop user does not run this.
// It may import an existing credential into the OS store. It does not print secrets.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUpdateManifestUrl } from "./baked-config.js";
import {
    decodeCommandOutput,
    importExistingInstall,
    queryWindowsBridgeTasks,
    takeoverLegacyBridge,
    windowsLegacyDirs,
} from "./import-existing-install.js";
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
            resolve({ code: code ?? 1, stdout: decodeCommandOutput(Buffer.concat(stdout)), stderr: "" }),
        );
        child.stdin.end(input);
    });

function bakedOrigin(): string {
    const fromEnv = (process.env.ORTHOCAD_BRIDGE_CLOUD_ORIGIN ?? "").trim();
    if (fromEnv.startsWith("https://") && !fromEnv.includes("REPLACE_WITH")) return fromEnv;
    const nextToBundle = join(dirname(fileURLToPath(import.meta.url)), "cloud-origin.txt");
    try {
        const file = readFileSync(nextToBundle, "utf8").trim();
        if (file.startsWith("https://")) return file;
    } catch {
        return "";
    }
    return "";
}

const bundleDir = dirname(fileURLToPath(import.meta.url));

function bakedManifestFile(): string {
    try {
        return readFileSync(join(bundleDir, "update-manifest-url.txt"), "utf8");
    } catch {
        return "";
    }
}

function publishBundledPublicKeys(): void {
    const bundled = join(bundleDir, "update-public-keys.json");
    if (!existsSync(bundled)) return;
    copyFileSync(bundled, join(dir, "update-public-keys.json"));
}

function writeBridgeConfig(bridgeId: string, existingManifest = ""): void {
    writeFileSync(
        configPath,
        JSON.stringify(
            {
                origin: readOrigin(configPath) || origin,
                bridgeId,
                updateManifestUrl: resolveUpdateManifestUrl({
                    envValue: process.env.ORTHOCAD_BRIDGE_UPDATE_MANIFEST_URL,
                    bakedFile: bakedManifestFile(),
                    existing: existingManifest,
                }),
            },
            null,
            2,
        ),
        { mode: 0o600 },
    );
}

function readOrigin(path: string): string {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as { origin?: unknown };
        return typeof parsed.origin === "string" ? parsed.origin : "";
    } catch {
        return "";
    }
}

const dir = stateDir();
mkdirSync(dir, { recursive: true });
const configPath = join(dir, "bridge.json");
const origin = bakedOrigin();
publishBundledPublicKeys();
if (!existsSync(configPath)) {
    if (!origin.startsWith("https://")) {
        console.error(
            "The installer is missing its OrthoCAD address. Download a current installer from the Printers page.",
        );
        process.exit(1);
    }
    writeBridgeConfig(randomUUID());
}

if (process.platform === "win32" || process.platform === "darwin") {
    const store = createPlatformSecretStore({ platform: process.platform, stateDir: dir, run: runner });
    const programData = process.env.PROGRAMDATA || "C:\\ProgramData";
    const userProfile = process.env.USERPROFILE || process.env.HOME || "";
    const candidates = process.platform === "win32" ? windowsLegacyDirs({ programData, userProfile }) : [dir];
    const taskXmlPath = join(dir, "previous-task.xml");
    const tasks = existsSync(taskXmlPath)
        ? [{ name: "OrthoCAD Print Bridge", xml: readFileSync(taskXmlPath, "utf8") }]
        : [];
    if (process.platform === "win32") {
        const live = await queryWindowsBridgeTasks(runner);
        for (const task of live) {
            if (!tasks.some((item) => item.xml === task.xml)) tasks.push(task);
        }
    }
    const imported = await takeoverLegacyBridge({
        store,
        candidateDirs: candidates,
        tasks,
        readFile: (path) => readFileSync(path, "utf8"),
        unlink: unlinkSync,
        disableTask: async (name) => {
            await runner("schtasks.exe", ["/Change", "/TN", name, "/DISABLE"], "");
        },
    });
    if (!imported) {
        await importExistingInstall({ stateDir: dir, store, taskXml: tasks[0]?.xml });
    } else if (imported.bridgeId) {
        const current = JSON.parse(readFileSync(configPath, "utf8")) as {
            updateManifestUrl?: string;
        };
        writeBridgeConfig(imported.bridgeId, current.updateManifestUrl ?? "");
    }
}

if (existsSync(configPath)) {
    const current = JSON.parse(readFileSync(configPath, "utf8")) as {
        bridgeId?: unknown;
        updateManifestUrl?: unknown;
    };
    if (typeof current.bridgeId === "string" && current.bridgeId) {
        const existingManifest =
            typeof current.updateManifestUrl === "string" ? current.updateManifestUrl : "";
        const resolved = resolveUpdateManifestUrl({
            envValue: process.env.ORTHOCAD_BRIDGE_UPDATE_MANIFEST_URL,
            bakedFile: bakedManifestFile(),
            existing: existingManifest,
        });
        if (resolved && resolved !== existingManifest.trim())
            writeBridgeConfig(current.bridgeId, existingManifest);
    }
}

console.error("print bridge config is ready");
