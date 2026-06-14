// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, test, beforeEach, afterEach } from "@rstest/core";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mockInitVertexOcct = rs.fn<() => Promise<void>>(async () => {});

rs.mock("@/lib/chili3d/occt-loader", () => ({
    initVertexOcct: () => mockInitVertexOcct(),
}));

rs.mock("@/lib/chili3d/occt-kernel", () => ({
    OcctKernel: class MockOcctKernel {
        readonly name = "opencascade-wasm";
        readonly ready = true;
        readonly tier = "authoritative";
        buildInsole = rs.fn();
        buildInsoleSolid = rs.fn();
        buildFromBase = rs.fn();
        exportSTL = rs.fn();
        exportManufacturingStlFromBase = rs.fn();
    },
}));

rs.mock("@/components/ErrorBoundary", () => ({
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
rs.mock("@/components/layout/KernelLoadingBanner", () => ({ KernelLoadingBanner: () => null }));
rs.mock("@/components/admin/AdminPortal", () => ({ AdminPortal: () => null }));
rs.mock("@/components/layout/LeftSidebar", () => ({ LeftSidebar: () => null }));
rs.mock("@/components/layout/RightPanel", () => ({ RightPanel: () => null }));
rs.mock("@/components/layout/StatusBar", () => ({ StatusBar: () => null }));
rs.mock("@/components/layout/TopNav", () => ({ TopNav: () => null }));
rs.mock("@/components/prescription-upload/PrescriptionUpload", () => ({ PrescriptionUpload: () => null }));
rs.mock("@/components/viewer/Viewer3D", () => ({ Viewer3D: () => null }));
rs.mock("@/features/clients/ClientsView", () => ({ ClientsView: () => null }));
rs.mock("@/features/auth/LoginScreen", () => ({ LoginScreen: () => null }));
rs.mock("@/hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: () => {} }));

describe("OCCT kernel init", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        mockInitVertexOcct.mockReset();
        mockInitVertexOcct.mockImplementation(async () => {});
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        root?.unmount();
        root = null;
        container.remove();
        rs.resetModules();
    });

    test("page load does not trigger kernel init", async () => {
        const App = (await import("@/App")).default;

        await act(async () => {
            root = createRoot(container);
            root.render(createElement(App));
            await Promise.resolve();
        });

        expect(mockInitVertexOcct).not.toHaveBeenCalled();
    });

    test("ensureKernelReady() is idempotent", async () => {
        const { ensureKernelReady } = await import("@/lib/chili3d/kernel");

        const [first, second, third] = await Promise.all([
            ensureKernelReady(),
            ensureKernelReady(),
            ensureKernelReady(),
        ]);

        expect(mockInitVertexOcct).toHaveBeenCalledTimes(1);
        expect(first).toBe(true);
        expect(second).toBe(true);
        expect(third).toBe(true);
    });
});
