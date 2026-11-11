// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { containsSecret } from "../shared/print-bridge-pairing";
import { importExistingInstall, readBridgeIdFromTaskXml } from "./import-existing-install";
import {
    type CommandRunner,
    CREDENTIAL_ACCOUNT,
    createPlatformSecretStore,
    memorySecretStore,
    migratePlaintextCredential,
    protectedBlobPath,
} from "./secret-store";

const SECRET = "legacy-bridge-credential-not-for-logs";

describe("protected bridge credential store", () => {
    test("a plaintext credential file is imported and removed", async () => {
        const dir = mkdtempSync(join(tmpdir(), "bridge-secret-"));
        writeFileSync(join(dir, "credential"), SECRET, { mode: 0o600 });
        const store = memorySecretStore();
        const logs: string[] = [];
        const result = await migratePlaintextCredential(store, dir);
        expect(result).toBe("imported");
        expect(await store.get(CREDENTIAL_ACCOUNT)).toBe(SECRET);
        expect(() => readFileSync(join(dir, "credential"), "utf8")).toThrow();
        expect(containsSecret(logs.join("\n"), SECRET)).toBe(false);
        expect(containsSecret(JSON.stringify({ result }), SECRET)).toBe(false);
    });

    test("windows and macOS commands keep the secret on stdin, not in argv or a plaintext file", async () => {
        const dir = mkdtempSync(join(tmpdir(), "bridge-dpapi-"));
        const calls: { command: string; args: string[]; input: string }[] = [];
        const saved = new Map<string, string>();
        const run: CommandRunner = async (command, args, input) => {
            calls.push({ command, args, input });
            const [op, account, value] = input.split("\n");
            if (op === "set" && account && value !== undefined) saved.set(account, value);
            if (op === "get" && account) return { code: 0, stdout: saved.get(account) ?? "", stderr: "" };
            if (op === "delete" && account) saved.delete(account);
            if (op === "export" && account) return { code: 0, stdout: `ciphertext:${account}`, stderr: "" };
            return { code: 0, stdout: "ok", stderr: "" };
        };
        for (const platform of ["win32", "darwin"] as const) {
            calls.length = 0;
            const store = createPlatformSecretStore({ platform, stateDir: dir, run });
            await store.set(CREDENTIAL_ACCOUNT, SECRET);
            expect(await store.get(CREDENTIAL_ACCOUNT)).toBe(SECRET);
            const rendered = JSON.stringify(
                calls.map((call) => ({ command: call.command, args: call.args })),
            );
            expect(containsSecret(rendered, SECRET)).toBe(false);
            const writes = calls.filter((call) => call.input.startsWith("set\n"));
            expect(writes.length).toBeGreaterThan(0);
            expect(writes.every((call) => call.input.includes(SECRET))).toBe(true);
            expect(calls.every((call) => !call.args.join(" ").includes(SECRET))).toBe(true);
        }
        const { fileBackedDpapiStore } = await import("./secret-store");
        await fileBackedDpapiStore(dir, run).set(CREDENTIAL_ACCOUNT, SECRET);
        const blob = readFileSync(protectedBlobPath(dir), "utf8");
        expect(blob.startsWith("ciphertext:")).toBe(true);
        expect(containsSecret(blob, SECRET)).toBe(false);
    });

    test("an existing bridge id is imported from task XML without returning the credential", async () => {
        const dir = mkdtempSync(join(tmpdir(), "bridge-import-"));
        const bridgeId = "5598afcd-1111-4111-8111-111111111111";
        writeFileSync(join(dir, "credential"), `${SECRET}\n`, { mode: 0o600 });
        const xml = `<Task><Environment><Variable>ORTHOCAD_BRIDGE_ID=${bridgeId}</Variable><Variable>ORTHOCAD_BRIDGE_STATE_DIR=${dir}</Variable></Environment></Task>`;
        expect(readBridgeIdFromTaskXml(xml)?.bridgeId).toBe(bridgeId);
        const store = memorySecretStore();
        const imported = await importExistingInstall({ stateDir: dir, store, taskXml: xml });
        expect(imported).toEqual({ bridgeId, origin: null, importedCredential: true });
        expect(await store.get(CREDENTIAL_ACCOUNT)).toBe(SECRET);
        expect(containsSecret(JSON.stringify(imported), SECRET)).toBe(false);
        expect(() => readFileSync(join(dir, "credential"), "utf8")).toThrow();
    });
});
