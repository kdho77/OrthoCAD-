// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { RELEASE_UPDATE_MANIFEST_URL } from "../baked-config";

const DUMMY_SIGNING_KEY = "dummy-update-signing-key-not-for-logs";

describe("print bridge workflows", () => {
    test("package and release workflows name the installers, the baked origin, and the update URL", () => {
        const packageWorkflow = readFileSync(".github/workflows/print-bridge-package.yml", "utf8");
        const releaseWorkflow = readFileSync(".github/workflows/print-bridge-release.yml", "utf8");
        const signing = readFileSync("vertex/print-bridge/packaging/macos/notarize-macos.sh", "utf8");
        const entitlements = readFileSync("vertex/print-bridge/packaging/macos/entitlements.plist", "utf8");
        for (const source of [packageWorkflow, releaseWorkflow]) {
            expect(source.includes("\t")).toBe(false);
            expect(source).toContain("https://orthocad.vertexorthopedic.com");
            expect(source).toContain(RELEASE_UPDATE_MANIFEST_URL);
            expect(source).toContain("OrthoCAD-Print-Bridge-Setup.exe");
            expect(source).toContain("OrthoCAD-Print-Bridge.pkg");
            expect(source).toContain("OrthoCAD-Print-Bridge.dmg");
            expect(source).toContain("SHORT-UNSIGNED");
        }
        expect(packageWorkflow).toContain("windows-latest");
        expect(packageWorkflow).toContain("macos-latest");
        expect(packageWorkflow).toContain("package-check");
        expect(packageWorkflow).toContain("if: always()");
        expect(packageWorkflow).toContain("notarize-macos.sh cleanup");
        for (const name of [
            "ORTHOCAD_MACOS_DEVID_APP_P12_BASE64",
            "ORTHOCAD_MACOS_DEVID_INSTALLER_P12_BASE64",
            "ORTHOCAD_MACOS_P12_PASSWORD",
            "ORTHOCAD_APPLE_TEAM_ID",
            "ORTHOCAD_ASC_API_KEY_P8_BASE64",
            "ORTHOCAD_ASC_API_KEY_ID",
            "ORTHOCAD_ASC_API_ISSUER_ID",
            "ORTHOCAD_APPLE_ID",
            "ORTHOCAD_APPLE_APP_PASSWORD",
            "ORTHOCAD_AUTHENTICODE_THUMBPRINT",
        ]) {
            expect(packageWorkflow).toContain(name);
        }
        expect(signing).toContain("codesign");
        expect(signing).toContain("--options runtime");
        expect(signing).toContain("entitlements.plist");
        expect(signing).toContain("productsign");
        expect(signing).toContain("notarytool submit");
        expect(signing).toContain("--key ");
        expect(signing).toContain("--key-id");
        expect(signing).toContain("--issuer");
        expect(signing).toContain("--apple-id");
        expect(signing).toContain("stapler staple");
        expect(signing).toContain("stapler validate");
        expect(signing).toContain("spctl");
        expect(signing).toContain("security create-keychain");
        expect(signing).toContain("security delete-keychain");
        expect(signing).not.toContain('echo "$ORTHOCAD_MACOS_DEVID_APP_P12_BASE64"');
        expect(signing).not.toContain('echo "$ORTHOCAD_MACOS_DEVID_INSTALLER_P12_BASE64"');
        expect(signing).not.toContain('echo "$ORTHOCAD_ASC_API_KEY_P8_BASE64"');
        expect(signing).not.toContain('echo "$ORTHOCAD_MACOS_P12_PASSWORD"');
        expect(signing).not.toContain("set -x");
        expect(entitlements).toContain("com.apple.security.cs.allow-jit");
        expect(entitlements).toContain("com.apple.security.cs.allow-unsigned-executable-memory");
        expect(releaseWorkflow).toContain("workflow_dispatch");
        expect(releaseWorkflow).toContain("ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY");
        expect(releaseWorkflow).toContain("guard-update-release.mjs");
        expect(releaseWorkflow).not.toContain("BEGIN PRIVATE KEY");
        expect(readFileSync("vertex/print-bridge/packaging/windows/build-installer.ps1", "utf8")).toContain(
            "update-public-keys.json",
        );
        expect(readFileSync("vertex/print-bridge/packaging/macos/build-pkg.sh", "utf8")).toContain(
            "update-public-keys.json",
        );
    });

    test("the release guard refuses a placeholder public key when a signing key is present", () => {
        const dir = mkdtempSync(join(tmpdir(), "bridge-release-guard-"));
        const placeholder = join(dir, "update-public-keys.json");
        writeFileSync(placeholder, '{ "replace-before-release": "REPLACE-WITH-PRODUCTION-PUBLIC-KEY" }\n');
        const refused = spawnSync(
            process.execPath,
            ["vertex/print-bridge/packaging/guard-update-release.mjs", placeholder],
            {
                encoding: "utf8",
                env: {
                    ...process.env,
                    ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY: DUMMY_SIGNING_KEY,
                    ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE: "",
                },
            },
        );
        expect(refused.status).toBe(1);
        expect(refused.stderr).toContain("REPLACE-WITH-PRODUCTION-PUBLIC-KEY");
        expect(`${refused.stdout}${refused.stderr}`).not.toContain(DUMMY_SIGNING_KEY);

        const skipped = spawnSync(
            process.execPath,
            ["vertex/print-bridge/packaging/guard-update-release.mjs", placeholder],
            {
                encoding: "utf8",
                env: {
                    ...process.env,
                    ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY: "",
                    ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE: "",
                },
            },
        );
        expect(skipped.status).toBe(0);
        expect(skipped.stdout).toContain("signing skipped");
        expect(`${skipped.stdout}${skipped.stderr}`).not.toContain(DUMMY_SIGNING_KEY);

        const allowed = spawnSync(
            process.execPath,
            ["vertex/print-bridge/packaging/guard-update-release.mjs"],
            {
                encoding: "utf8",
                env: {
                    ...process.env,
                    ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY: DUMMY_SIGNING_KEY,
                    ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY_FILE: "",
                },
            },
        );
        expect(allowed.status).toBe(0);
        expect(`${allowed.stdout}${allowed.stderr}`).not.toContain(DUMMY_SIGNING_KEY);
        rmSync(dir, { recursive: true, force: true });
    });

    test("a release payload build copies the public key and bakes the manifest URL", () => {
        const built = spawnSync(process.execPath, ["print-bridge/packaging/build-payload.mjs"], {
            cwd: "vertex",
            encoding: "utf8",
            env: {
                ...process.env,
                ORTHOCAD_BRIDGE_CLOUD_ORIGIN: "https://orthocad.vertexorthopedic.com",
                ORTHOCAD_BRIDGE_UPDATE_MANIFEST_URL: RELEASE_UPDATE_MANIFEST_URL,
            },
        });
        expect(built.status).toBe(0);
        const keys = readFileSync("vertex/print-bridge/packaging/dist/update-public-keys.json", "utf8");
        expect(keys).toContain("BEGIN PUBLIC KEY");
        expect(keys).not.toContain("REPLACE-WITH-PRODUCTION-PUBLIC-KEY");
        expect(
            readFileSync("vertex/print-bridge/packaging/dist/update-manifest-url.txt", "utf8").trim(),
        ).toBe(RELEASE_UPDATE_MANIFEST_URL);
    });
});
