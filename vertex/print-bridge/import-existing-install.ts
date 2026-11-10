// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Double-click takeover of an already enrolled bridge.
// Reads a previous bridge id from bridge.json, a bridge-id file, or Task Scheduler XML.
// Imports the plaintext credential into the protected store and deletes the file.
// The credential is not included in the result and is not logged.

import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { migratePlaintextCredential, type SecretStore } from "./secret-store.js";

export interface ImportedInstall {
    bridgeId: string;
    origin: string | null;
    importedCredential: boolean;
}

export function readBridgeIdFromTaskXml(xml: string): { bridgeId: string; stateDir: string | null } | null {
    const id = /ORTHOCAD_BRIDGE_ID(?:=|\s+|["'=]+)([0-9a-fA-F-]{8,64})/.exec(xml);
    if (!id?.[1]) return null;
    const dir = /ORTHOCAD_BRIDGE_STATE_DIR(?:=|\s+|["'=]+)([^"<\s]+)/.exec(xml);
    return { bridgeId: id[1], stateDir: dir?.[1] ?? null };
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
