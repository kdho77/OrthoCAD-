// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    INSTALLER_UNPUBLISHED_NOTICE,
    INSTALLERS,
    lookupPublishedInstallers,
    RELEASE_CLOUD_ORIGIN,
} from "./installer-download";

describe("installer download publication", () => {
    test("a missing GitHub release is a notice, and a published asset is downloadable", async () => {
        expect(RELEASE_CLOUD_ORIGIN).toBe("https://orthocad.vertexorthopedic.com");
        expect(INSTALLERS.windows.filename).toBe("OrthoCAD-Print-Bridge-Setup.exe");
        expect(INSTALLERS.macos.filename).toBe("OrthoCAD-Print-Bridge.pkg");
        expect(INSTALLERS["macos-dmg"].filename).toBe("OrthoCAD-Print-Bridge.dmg");
        const missing = await lookupPublishedInstallers(async () => new Response("missing", { status: 404 }));
        expect(missing.windows).toBe(false);
        expect(INSTALLER_UNPUBLISHED_NOTICE).toContain("not published yet");
        const published = await lookupPublishedInstallers(
            async () =>
                new Response(
                    JSON.stringify({
                        assets: [
                            { name: "OrthoCAD-Print-Bridge-Setup.exe" },
                            { name: "OrthoCAD-Print-Bridge.pkg" },
                            { name: "OrthoCAD-Print-Bridge.dmg" },
                        ],
                    }),
                    { status: 200 },
                ),
        );
        expect(published).toEqual({ known: true, windows: true, macos: true, dmg: true });
    });
});
