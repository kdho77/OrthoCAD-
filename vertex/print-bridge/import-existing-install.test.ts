// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { containsSecret } from "../shared/print-bridge-pairing";
import {
    discoverLegacyBridge,
    scheduledTasksToReplace,
    takeoverLegacyBridge,
    windowsLegacyDirs,
} from "./import-existing-install";
import { CREDENTIAL_ACCOUNT, memorySecretStore } from "./secret-store";

const SECRET = "legacy-bridge-credential-not-for-logs";
const BRIDGE_ID = "5598afcd-1111-4111-8111-111111111111";

describe("legacy print bridge takeover", () => {
    test("finds the credential from task XML, ProgramData, and a user profile, then disables the task", async () => {
        const programData = "C:\\ProgramData";
        const userProfile = "C:\\Users\\Shop";
        const dirs = windowsLegacyDirs({ programData, userProfile });
        expect(dirs).toContain("C:\\ProgramData\\OrthoCAD\\PrintBridge");
        expect(dirs).toContain("C:\\Users\\Shop\\AppData\\Roaming\\OrthoCAD\\PrintBridge");
        expect(dirs).toContain("C:\\Users\\Shop\\AppData\\Local\\OrthoCAD\\PrintBridge");

        const files = new Map<string, string>();
        const taskDir = "D:\\ShopRelay";
        files.set(`${taskDir}\\credential`, SECRET);
        files.set(`${taskDir}\\bridge-id`, BRIDGE_ID);
        const xml = `<Task><Environment><Variable>ORTHOCAD_BRIDGE_ID=${BRIDGE_ID}</Variable><Variable>ORTHOCAD_BRIDGE_STATE_DIR=${taskDir}</Variable></Environment><Command>npx tsx print-bridge/main.ts</Command></Task>`;
        const removed: string[] = [];
        const disabled: string[] = [];
        const store = memorySecretStore();
        const result = await takeoverLegacyBridge({
            store,
            candidateDirs: dirs,
            tasks: [{ name: "OrthoCAD legacy relay", xml }],
            readFile: (path) => {
                const value = files.get(path);
                if (value === undefined) throw new Error("missing");
                return value;
            },
            unlink: (path) => {
                removed.push(path);
                files.delete(path);
            },
            disableTask: async (name) => {
                disabled.push(name);
            },
        });
        expect(result).toEqual({
            bridgeId: BRIDGE_ID,
            importedCredential: true,
            disabledTasks: ["OrthoCAD legacy relay"],
        });
        expect(disabled).toEqual(["OrthoCAD legacy relay"]);
        expect(removed).toEqual([`${taskDir}\\credential`]);
        expect(await store.get(CREDENTIAL_ACCOUNT)).toBe(SECRET);
        expect(containsSecret(JSON.stringify(result), SECRET)).toBe(false);
        expect(scheduledTasksToReplace([{ name: "Other", xml: "<Task>nothing</Task>" }])).toEqual([]);

        const programFiles = new Map<string, string>([
            ["C:\\ProgramData\\OrthoCAD\\PrintBridge\\credential", SECRET],
            ["C:\\ProgramData\\OrthoCAD\\PrintBridge\\bridge.json", JSON.stringify({ bridgeId: BRIDGE_ID })],
        ]);
        expect(
            discoverLegacyBridge({
                candidateDirs: dirs,
                tasks: [],
                readFile: (path) => {
                    const value = programFiles.get(path);
                    if (value === undefined) throw new Error("missing");
                    return value;
                },
            })?.stateDir,
        ).toBe("C:\\ProgramData\\OrthoCAD\\PrintBridge");

        const profile = "C:\\Users\\Shop\\AppData\\Roaming\\OrthoCAD\\PrintBridge";
        const profileFiles = new Map<string, string>([
            [`${profile}\\credential`, SECRET],
            [`${profile}\\bridge-id`, BRIDGE_ID],
        ]);
        expect(
            discoverLegacyBridge({
                candidateDirs: dirs,
                tasks: [],
                readFile: (path) => {
                    const value = profileFiles.get(path);
                    if (value === undefined) throw new Error("missing");
                    return value;
                },
            })?.bridgeId,
        ).toBe(BRIDGE_ID);
    });
});
