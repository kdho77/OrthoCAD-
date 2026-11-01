// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { useExportFileTypeStore } from "@/features/exports/export-file-type-store";
import { useExportSessionStore } from "@/features/exports/export-session-store";
import { usePrintExportSettingsStore } from "@/features/exports/print-export-settings-store";
import { ViewportBusyOverlay } from "@/features/exports/viewport-busy-overlay";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

rs.mock("@/features/exports/run-export-action", () => ({
    runExportForChoice: () =>
        new Promise((resolve) => {
            window.setTimeout(
                () =>
                    resolve({
                        ok: true,
                        record: {
                            id: "test-stl",
                            kind: "stl",
                            target: "pair",
                            filename: "insole-L.stl",
                            sizeBytes: 12,
                            blob: new Blob(["x"]),
                            tokensCharged: 1,
                            designRevision: "rev",
                            createdAt: Date.now(),
                            files: [
                                {
                                    side: "left",
                                    filename: "insole-L.stl",
                                    sizeBytes: 6,
                                    blob: new Blob(["l"]),
                                },
                                {
                                    side: "right",
                                    filename: "insole-R.stl",
                                    sizeBytes: 6,
                                    blob: new Blob(["r"]),
                                },
                            ],
                        },
                    }),
                50,
            );
        }),
}));

describe("ViewportBusyOverlay during export", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    afterEach(() => {
        root?.unmount();
        root = null;
        container?.remove();
        useExportSessionStore.setState({
            progress: { phase: "idle" },
            progressStartedAtMs: null,
            byKind: {},
        });
    });

    test("shows overlay while async export runs", async () => {
        container = document.createElement("div");
        container.className = "relative h-[480px] w-full";
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
        useMillingProfileStore.setState({ machine: "printer" });
        useDesignStore.setState({ exportTarget: "pair" });
        useExportFileTypeStore.setState({ exportFileType: "stl", lastByUserId: { c1: "stl" } });
        usePrintExportSettingsStore.setState({ apexMaterialId: "ApexCore" });

        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(
                    React.Fragment,
                    null,
                    createElement(ViewportBusyOverlay),
                    createElement(ExportPanel),
                ),
            );
        });

        const primary = container.querySelector('[data-testid="print-export-primary"]') as HTMLButtonElement;
        expect(primary).not.toBeNull();

        await act(async () => {
            primary.click();
            await Promise.resolve();
        });

        expect(useExportSessionStore.getState().progress.phase).toBe("exporting");
        expect(container.querySelector('[data-testid="viewport-busy-overlay"]')).not.toBeNull();

        await act(async () => {
            await new Promise((r) => window.setTimeout(r, 120));
        });

        expect(useExportSessionStore.getState().progress.phase).toBe("idle");
    });
});
