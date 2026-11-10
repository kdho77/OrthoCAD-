// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { containsSecret } from "../shared/print-bridge-pairing";
import {
    bridgeTaskNamesFromSchtasksList,
    decodeCommandOutput,
    discoverLegacyBridge,
    installedBridgePlan,
    queryWindowsBridgeTasks,
    readBridgeIdFromTaskXml,
    scheduledTasksToReplace,
    takeoverLegacyBridge,
    windowsLegacyDirs,
} from "./import-existing-install";
import { type CommandRunner, CREDENTIAL_ACCOUNT, memorySecretStore } from "./secret-store";

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

    test("a live schtasks query exports XML and imports the custom state dir", async () => {
        const taskDir = "D:\\Custom Shop";
        const xml = `<Task><Environment><Variable>ORTHOCAD_BRIDGE_ID=${BRIDGE_ID}</Variable><Variable>ORTHOCAD_BRIDGE_STATE_DIR=${taskDir}</Variable></Environment><Command>npx tsx print-bridge/main.ts</Command></Task>`;
        const calls: string[][] = [];
        const run: CommandRunner = async (command, args) => {
            calls.push([command, ...args]);
            expect([command, ...args].join(" ")).not.toContain(SECRET);
            if (args.includes("LIST")) {
                return {
                    code: 0,
                    stdout: "TaskName: \\Shop Relay\nTask To Run: npx tsx print-bridge/main.ts\n",
                    stderr: "",
                };
            }
            if (args.includes("CSV")) {
                return { code: 0, stdout: '"\\OrthoCAD Print Bridge","N/A","Ready"\n', stderr: "" };
            }
            if (args.includes("/XML") && args.includes("\\Shop Relay"))
                return { code: 0, stdout: xml, stderr: "" };
            return { code: 1, stdout: "", stderr: "" };
        };
        const files = new Map<string, string>([
            [`${taskDir}\\credential`, SECRET],
            [`${taskDir}\\bridge.json`, JSON.stringify({ bridgeId: BRIDGE_ID })],
        ]);
        const tasks = await queryWindowsBridgeTasks(run);
        expect(
            calls.some(
                (call) => call[0] === "schtasks.exe" && call.includes("/Query") && call.includes("LIST"),
            ),
        ).toBe(true);
        expect(calls.some((call) => call.includes("/Query") && call.includes("/XML"))).toBe(true);
        expect(
            bridgeTaskNamesFromSchtasksList("TaskName: \\Shop Relay\nTask To Run: print-bridge/main.ts\n"),
        ).toEqual(["\\Shop Relay"]);
        const found = discoverLegacyBridge({
            candidateDirs: windowsLegacyDirs({
                programData: "C:\\ProgramData",
                userProfile: "C:\\Users\\Shop",
            }),
            tasks,
            readFile: (path) => {
                const value = files.get(path);
                if (value === undefined) throw new Error("missing");
                return value;
            },
        });
        expect(found).toEqual({ bridgeId: BRIDGE_ID, stateDir: taskDir });
        expect(installedBridgePlan(found)).toBe("import");
        const removed: string[] = [];
        const store = memorySecretStore();
        const imported = await takeoverLegacyBridge({
            store,
            candidateDirs: windowsLegacyDirs({
                programData: "C:\\ProgramData",
                userProfile: "C:\\Users\\Shop",
            }),
            tasks,
            readFile: (path) => {
                const value = files.get(path);
                if (value === undefined) throw new Error("missing");
                return value;
            },
            unlink: (path) => {
                removed.push(path);
                files.delete(path);
            },
            disableTask: async () => undefined,
        });
        expect(imported?.bridgeId).toBe(BRIDGE_ID);
        expect(imported?.importedCredential).toBe(true);
        expect(removed).toEqual([`${taskDir}\\credential`]);
        expect(containsSecret(JSON.stringify(imported), SECRET)).toBe(false);
        expect(calls.every((call) => !call.join(" ").includes(SECRET))).toBe(true);

        const spaced = `<Variable name="ORTHOCAD_BRIDGE_STATE_DIR">D:\\Custom Shop\\Relay</Variable><Variable name="ORTHOCAD_BRIDGE_ID">${BRIDGE_ID}</Variable>`;
        expect(readBridgeIdFromTaskXml(spaced)?.stateDir).toBe("D:\\Custom Shop\\Relay");
        const encoded = Buffer.concat([
            Buffer.from([0xff, 0xfe]),
            Buffer.from(`<Task>ORTHOCAD_BRIDGE_STATE_DIR=${taskDir}</Task>`, "utf16le"),
        ]);
        expect(decodeCommandOutput(encoded)).toContain(`ORTHOCAD_BRIDGE_STATE_DIR=${taskDir}`);
        expect(readBridgeIdFromTaskXml(decodeCommandOutput(encoded))?.stateDir).toBe(taskDir);
    });

    test("falls back to pairing when no scheduled task and no credential exist", async () => {
        const run: CommandRunner = async (_command, args) => {
            if (args.includes("/XML")) return { code: 1, stdout: "", stderr: "" };
            if (args.includes("LIST")) {
                return { code: 0, stdout: "TaskName: \\Microsoft\\Windows\\DiskCleanup\n", stderr: "" };
            }
            return { code: 0, stdout: '"\\Microsoft\\Windows\\DiskCleanup","N/A","Ready"\n', stderr: "" };
        };
        const tasks = await queryWindowsBridgeTasks(run);
        const found = discoverLegacyBridge({
            candidateDirs: windowsLegacyDirs({
                programData: "C:\\ProgramData",
                userProfile: "C:\\Users\\Shop",
            }),
            tasks,
            readFile: () => {
                throw new Error("missing");
            },
        });
        expect(found).toBeNull();
        expect(installedBridgePlan(found)).toBe("pairing");
        expect(JSON.stringify({ tasks, found })).not.toContain(SECRET);
    });
});
