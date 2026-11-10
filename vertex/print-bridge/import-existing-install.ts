// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Double-click takeover of an already enrolled bridge.
// Reads a previous bridge id from bridge.json, a bridge-id file, or Task Scheduler XML.
// Imports the plaintext credential into the protected store and deletes the file.
// The credential is not included in the result and is not logged.

import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { type CommandRunner, migratePlaintextCredential, type SecretStore } from "./secret-store.js";

export interface ImportedInstall {
    bridgeId: string;
    origin: string | null;
    importedCredential: boolean;
}

export function decodeCommandOutput(buffer: Buffer): string {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.toString("utf16le").replace(/^\uFEFF/, "");
    }
    const zero = buffer.indexOf(0);
    if (zero !== -1 && zero < 8) return buffer.toString("utf16le").replace(/^\uFEFF/, "");
    return buffer.toString("utf8");
}

export function normalizeSchtasksText(text: string): string {
    if (!text.includes("\u0000")) return text.replace(/^\uFEFF/, "");
    return Buffer.from(text, "utf8")
        .toString("utf16le")
        .replace(/^\uFEFF/, "");
}

export function readBridgeIdFromTaskXml(xml: string): { bridgeId: string; stateDir: string | null } | null {
    const text = normalizeSchtasksText(xml);
    const bridgeId = readTaggedValue(text, "ORTHOCAD_BRIDGE_ID", /[0-9a-fA-F-]{8,64}/);
    const stateDir = readTaggedValue(text, "ORTHOCAD_BRIDGE_STATE_DIR", /[^"<\r\n]+/);
    if (!bridgeId && !stateDir) return null;
    return { bridgeId, stateDir: stateDir ? stateDir.trim() : null };
}

function readTaggedValue(xml: string, name: string, value: RegExp): string {
    const patterns = [
        new RegExp(`${name}\\s*=\\s*"?(${value.source})`, "i"),
        new RegExp(`name=["']${name}["'][^>]*value=["'](${value.source})["']`, "i"),
        new RegExp(`<(?:Variable|EnvironmentVariable)[^>]*name=["']${name}["'][^>]*>(${value.source})<`, "i"),
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(xml);
        if (match?.[1]) return match[1].trim();
    }
    return "";
}

export async function importExistingInstall(input: {
    stateDir: string;
    store: SecretStore;
    taskXml?: string;
    readFile?: (path: string) => string;
    unlink?: (path: string) => void;
}): Promise<ImportedInstall | null> {
    const readFile = input.readFile ?? ((path: string) => readFileSync(path, "utf8"));
    const fromJson = readJson(readFile, join(input.stateDir, "bridge.json"));
    const fromIdFile = readText(readFile, join(input.stateDir, "bridge-id"));
    const fromTask = input.taskXml ? readBridgeIdFromTaskXml(input.taskXml) : null;
    const bridgeId = fromJson?.bridgeId || fromIdFile || fromTask?.bridgeId || "";
    if (!bridgeId) return null;
    const migration = await migratePlaintextCredential(input.store, input.stateDir, {
        readFile,
        unlink: input.unlink ?? unlinkSync,
    });
    return {
        bridgeId,
        origin: fromJson?.origin ?? null,
        importedCredential: migration === "imported",
    };
}

function childPath(dir: string, name: string): string {
    const sep = dir.includes("\\") ? "\\" : "/";
    return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
}

export function windowsLegacyDirs(env: { programData: string; userProfile: string }): string[] {
    const root = (base: string, ...parts: string[]) => [base.replace(/[\\/]+$/, ""), ...parts].join("\\");
    return [
        root(env.programData, "OrthoCAD", "PrintBridge"),
        root(env.userProfile, "OrthoCAD", "PrintBridge"),
        root(env.userProfile, "AppData", "Roaming", "OrthoCAD", "PrintBridge"),
        root(env.userProfile, "AppData", "Local", "OrthoCAD", "PrintBridge"),
    ];
}

const BRIDGE_TASK_NAME = /orthocad|print-?bridge/i;
const BRIDGE_TASK_BODY = /ORTHOCAD_BRIDGE_ID|ORTHOCAD_BRIDGE_STATE_DIR|print-bridge[/\\]main\.ts/i;

export function bridgeTaskNamesFromSchtasksCsv(stdout: string): string[] {
    const names: string[] = [];
    for (const line of normalizeSchtasksText(stdout).split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const quoted = /^"([^"]+)"/.exec(trimmed);
        const name = (quoted?.[1] ?? trimmed.split(",")[0] ?? "").trim();
        if (!name || name === "TaskName") continue;
        if (BRIDGE_TASK_NAME.test(name)) names.push(name);
    }
    return [...new Set(names)];
}

export function bridgeTaskNamesFromSchtasksList(stdout: string): string[] {
    const names: string[] = [];
    for (const block of normalizeSchtasksText(stdout).split(/\r?\n\s*\r?\n/)) {
        const name = /(?:^|\n)\s*TaskName:\s*(.+)/i.exec(block)?.[1]?.trim();
        if (!name) continue;
        if (BRIDGE_TASK_NAME.test(name) || BRIDGE_TASK_BODY.test(block)) names.push(name);
    }
    return [...new Set(names)];
}

export async function queryWindowsBridgeTasks(run: CommandRunner): Promise<{ name: string; xml: string }[]> {
    const names = new Set<string>(["\\OrthoCAD Print Bridge", "OrthoCAD Print Bridge"]);
    const listed = await run("schtasks.exe", ["/Query", "/FO", "LIST", "/V"], "");
    if (listed.code === 0) {
        for (const name of bridgeTaskNamesFromSchtasksList(listed.stdout)) names.add(name);
    }
    const csv = await run("schtasks.exe", ["/Query", "/FO", "CSV", "/NH"], "");
    if (csv.code === 0) {
        for (const name of bridgeTaskNamesFromSchtasksCsv(csv.stdout)) names.add(name);
    }
    const tasks: { name: string; xml: string }[] = [];
    const seen = new Set<string>();
    for (const name of names) {
        const exported = await run("schtasks.exe", ["/Query", "/TN", name, "/XML"], "");
        if (exported.code !== 0) continue;
        const xml = normalizeSchtasksText(exported.stdout);
        if (!xml.includes("<Task") || seen.has(xml)) continue;
        seen.add(xml);
        tasks.push({ name, xml });
    }
    return tasks;
}

export function installedBridgePlan(
    discovered: { bridgeId: string; stateDir: string } | null,
): "import" | "pairing" {
    return discovered?.bridgeId ? "import" : "pairing";
}

export function scheduledTasksToReplace(tasks: { name: string; xml: string }[]): string[] {
    return tasks
        .filter((task) =>
            /ORTHOCAD_BRIDGE_ID|ORTHOCAD_BRIDGE_STATE_DIR|print-bridge[/\\]main\.ts/.test(task.xml),
        )
        .map((task) => task.name);
}

export function discoverLegacyBridge(input: {
    candidateDirs: string[];
    tasks: { name: string; xml: string }[];
    readFile: (path: string) => string;
}): { bridgeId: string; stateDir: string } | null {
    const dirs = [...input.candidateDirs];
    for (const task of input.tasks) {
        const parsed = readBridgeIdFromTaskXml(task.xml);
        if (parsed?.stateDir) dirs.unshift(parsed.stateDir);
    }
    const seen = new Set<string>();
    for (const dir of dirs) {
        if (seen.has(dir)) continue;
        seen.add(dir);
        const credentialPath = childPath(dir, "credential");
        let credential = "";
        try {
            credential = input.readFile(credentialPath).trim();
        } catch {
            credential = "";
        }
        if (!credential) continue;
        const fromJson = readJson(input.readFile, childPath(dir, "bridge.json"));
        const fromId = readText(input.readFile, childPath(dir, "bridge-id"));
        const fromTask = input.tasks
            .map((task) => readBridgeIdFromTaskXml(task.xml))
            .find((item) => item && (!item.stateDir || item.stateDir === dir));
        const bridgeId = fromJson?.bridgeId || fromId || fromTask?.bridgeId || "";
        if (!bridgeId) continue;
        return { bridgeId, stateDir: dir };
    }
    return null;
}

export async function takeoverLegacyBridge(input: {
    store: SecretStore;
    candidateDirs: string[];
    tasks: { name: string; xml: string }[];
    readFile: (path: string) => string;
    unlink: (path: string) => void;
    disableTask: (name: string) => Promise<void>;
}): Promise<{ bridgeId: string; importedCredential: boolean; disabledTasks: string[] } | null> {
    const found = discoverLegacyBridge(input);
    if (!found) return null;
    const migration = await migratePlaintextCredential(input.store, found.stateDir, {
        readFile: input.readFile,
        unlink: input.unlink,
    });
    const names = scheduledTasksToReplace(input.tasks);
    for (const name of names) await input.disableTask(name);
    return {
        bridgeId: found.bridgeId,
        importedCredential: migration === "imported",
        disabledTasks: names,
    };
}

function readJson(
    readFile: (path: string) => string,
    path: string,
): { bridgeId?: string; origin?: string } | null {
    try {
        const parsed = JSON.parse(readFile(path)) as { bridgeId?: unknown; origin?: unknown };
        return {
            bridgeId: typeof parsed.bridgeId === "string" ? parsed.bridgeId.trim() : undefined,
            origin: typeof parsed.origin === "string" ? parsed.origin : undefined,
        };
    } catch {
        return null;
    }
}

function readText(readFile: (path: string) => string, path: string): string {
    try {
        return readFile(path).trim();
    } catch {
        return "";
    }
}
