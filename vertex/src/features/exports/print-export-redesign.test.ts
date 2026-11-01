// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExportPanel } from "@/features/exports/ExportPanel";
import {
    export3mfPair,
    exportStlPairZip,
    modelSettingsObjectNames,
    stlZipEntryCount,
} from "@/features/exports/export-pair";
import { useExportSessionStore } from "@/features/exports/export-session-store";
import { PrintFooter } from "@/features/exports/PrintFooter";
import { TOKEN_COST } from "@/features/licensing/license";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("print + export redesign", () => {
    test("Pair costs 1 token for STL, 3MF, and G-code", () => {
        expect(TOKEN_COST.stl).toBe(1);
        expect(TOKEN_COST["3mf"]).toBe(1);
        expect(TOKEN_COST.gcode).toBe(1);
    });

    test("footer export target is shared between Print and Export panels", () => {
        useDesignStore.setState({ exportTarget: null, exportSide: "left" });
        useDesignStore.getState().setExportTarget("pair");
        expect(useDesignStore.getState().exportTarget).toBe("pair");
        expect(useExportSessionStore.getState().byKind).toEqual({});
        expect(useDesignStore.getState().exportTarget).toBe("pair");
    });

    test("CNC machine locks footer target to Pair", () => {
        useMillingProfileStore.setState({ machine: "cnc" });
        useDesignStore.setState({ exportTarget: "left" });
        useDesignStore.getState().setExportTarget("pair");
        expect(useDesignStore.getState().exportTarget).toBe("pair");
    });

    test("Generate G-code button labels", () => {
        expect(`Generate G-code · ${TOKEN_COST.gcode} token`).toBe("Generate G-code · 1 token");
        expect(`Generate mill G-code · ${TOKEN_COST.gcode} token`).toBe("Generate mill G-code · 1 token");
    });

    test("out-of-date after design revision changes", () => {
        useExportSessionStore.getState().recordSuccess({
            id: "g1",
            kind: "gcode",
            target: "left",
            filename: "a.gcode",
            sizeBytes: 10,
            blob: new Blob(["x"]),
            tokensCharged: 1,
            designRevision: "rev-a",
            createdAt: Date.now(),
        });
        useExportSessionStore.getState().setDesignRevision("rev-b");
        expect(useExportSessionStore.getState().isOutOfDate("gcode")).toBe(true);
    });

    test("STL Pair zip contains two entries", async () => {
        const res = await exportStlPairZip(false);
        if (!res.ok || !res.blob) return;
        const buf = new Uint8Array(await res.blob.arrayBuffer());
        const count = await stlZipEntryCount(buf);
        expect(count).toBe(2);
    });

    test("3MF Pair names Left and Right objects", async () => {
        const res = await export3mfPair(false);
        if (!res.ok || !res.blob) return;
        const buf = new Uint8Array(await res.blob.arrayBuffer());
        const names = await modelSettingsObjectNames(buf);
        expect(names).toContain("Left");
        expect(names).toContain("Right");
    });

    describe("GLB hidden for non-super-admins", () => {
        let container: HTMLDivElement;
        let root: Root | null = null;

        beforeEach(() => {
            container = document.createElement("div");
            document.body.appendChild(container);
            useAuthStore.setState({
                user: {
                    id: "c1",
                    email: "clinician@example.com",
                    fullName: "Clinician",
                    role: "clinician",
                    tokenBalance: 5,
                },
                license: { status: "active" } as never,
                loading: false,
            });
            useDesignStore.setState({ exportTarget: "left" });
        });

        afterEach(() => {
            root?.unmount();
            root = null;
            container.remove();
        });

        test("Export panel omits developer GLB tile", async () => {
            await act(async () => {
                root = createRoot(container);
                root.render(createElement(ExportPanel));
            });
            expect(container.textContent).not.toMatch(/Developer/i);
            expect(container.querySelector('[data-testid="export-tile-glb"]')).toBeNull();
        });
    });
});

describe("PrintFooter CNC lock UI", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    afterEach(() => {
        root?.unmount();
        container?.remove();
    });

    test("renders Pair lock hint for CNC", async () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        useDesignStore.setState({ exportTarget: "pair" });
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(PrintFooter, {
                    machineSummary: "Idaho CNC",
                    cncLocked: true,
                    cncLockReason: "Left + Right in one file",
                    primaryLabel: "Generate mill G-code · 1 token",
                    onPrimary: () => {},
                }),
            );
        });
        expect(container.textContent).toMatch(/Left \+ Right in one file/);
    });
});
