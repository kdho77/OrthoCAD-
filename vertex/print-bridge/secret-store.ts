// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Bridge credentials live in Windows DPAPI or the macOS Keychain.
// Plaintext credential files are imported once and then removed.
// This module does not log secret values.

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CREDENTIAL_ACCOUNT = "bridge-credential";
export const DEVICE_PROOF_ACCOUNT = "bridge-device-proof";

export interface SecretStore {
    get(account: string): Promise<string | null>;
    set(account: string, value: string): Promise<void>;
    delete(account: string): Promise<void>;
}

export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

export type CommandRunner = (command: string, args: string[], input: string) => Promise<CommandResult>;

export function memorySecretStore(): SecretStore & { dump(): Record<string, string> } {
    const values = new Map<string, string>();
    return {
        async get(account) {
            return values.get(account) ?? null;
        },
        async set(account, value) {
            values.set(account, value);
        },
        async delete(account) {
            values.delete(account);
        },
        dump() {
            return Object.fromEntries(values);
        },
    };
}

/**
 * Moves `<stateDir>/credential` into the OS store and deletes the file.
 * An existing protected value is kept. A leftover plaintext file is still removed.
 */
export async function migratePlaintextCredential(
    store: SecretStore,
    stateDir: string,
    io: {
        readFile: (path: string) => string;
        unlink: (path: string) => void;
    } = {
        readFile: (path) => readFileSync(path, "utf8"),
        unlink: (path) => unlinkSync(path),
    },
): Promise<"imported" | "removed" | "absent"> {
    const file = join(stateDir, "credential");
    let plaintext: string | null = null;
    try {
        plaintext = io.readFile(file).trim() || null;
    } catch {
        plaintext = null;
    }
    const protectedValue = await store.get(CREDENTIAL_ACCOUNT);
    if (protectedValue) {
        if (plaintext !== null) io.unlink(file);
        return plaintext !== null ? "removed" : "absent";
    }
    if (!plaintext) return "absent";
    await store.set(CREDENTIAL_ACCOUNT, plaintext);
    io.unlink(file);
    return "imported";
}

export function createPlatformSecretStore(options: {
    platform: NodeJS.Platform;
    stateDir: string;
    run: CommandRunner;
    helper?: string;
}): SecretStore {
    if (options.platform === "win32") {
        return commandStore(options.run, "dpapi", options.helper ?? "dpapi-store.ps1");
    }
    if (options.platform === "darwin") {
        return commandStore(options.run, "keychain", options.helper ?? "keychain-store.swift");
    }
    throw new Error("This print bridge build stores credentials only on Windows and macOS.");
}

function commandStore(run: CommandRunner, backend: "dpapi" | "keychain", helper: string): SecretStore {
    const command = backend === "dpapi" ? "powershell.exe" : "/usr/bin/swift";
    const args =
        backend === "dpapi"
            ? ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-File", helper]
            : [helper];
    return {
        async get(account) {
            const result = await run(command, args, `get\n${account}\n`);
            if (result.code !== 0) return null;
            const value = result.stdout.trim();
            return value || null;
        },
        async set(account, value) {
            const result = await run(command, args, `set\n${account}\n${value}`);
            if (result.code !== 0) throw new Error("The protected credential store rejected the write.");
        },
        async delete(account) {
            await run(command, args, `delete\n${account}\n`);
        },
    };
}

export function protectedBlobPath(stateDir: string): string {
    return join(stateDir, "credential.dpapi");
}

/** Test helper for a Windows-shaped store that writes ciphertext, not the secret. */
export function fileBackedDpapiStore(stateDir: string, run: CommandRunner): SecretStore {
    const store = commandStore(run, "dpapi", "dpapi-store.ps1");
    return {
        async get(account) {
            return store.get(account);
        },
        async set(account, value) {
            await store.set(account, value);
            const result = await run(
                "powershell.exe",
                ["-NoProfile", "-Command", "-"],
                `export\n${account}\n`,
            );
            if (result.code !== 0) throw new Error("The protected credential store rejected the write.");
            writeFileSync(protectedBlobPath(stateDir), result.stdout, { mode: 0o600 });
        },
        async delete(account) {
            await store.delete(account);
            try {
                unlinkSync(protectedBlobPath(stateDir));
            } catch {
                // The blob is already gone.
            }
        },
    };
}
