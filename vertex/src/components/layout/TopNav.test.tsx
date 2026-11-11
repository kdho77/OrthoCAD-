// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import type { UserProfile } from "@/types";
import { TopNav } from "./TopNav";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

rs.mock("@/features/designs/SaveControl", () => ({
    SaveControl: () => null,
}));

const navigateMock = rs.fn();
rs.mock("@/features/admin/admin-nav", () => ({
    navigate: (...args: unknown[]) => navigateMock(...args),
    showSuperAdminLink: (role: string | undefined) => role === "super_admin",
}));

const clinician: UserProfile = {
    id: "c1",
    email: "clinician@example.com",
    fullName: "Casey Clinician",
    role: "clinician",
    tokenBalance: 10,
};

const superAdmin: UserProfile = {
    ...clinician,
    id: "s1",
    email: "kdho@vertexorthopedic.com",
    fullName: "Kendon",
    role: "super_admin",
};

describe("TopNav logo", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        useAuthStore.setState({ user: clinician, loading: false });
        navigateMock.mockReset();
    });

    afterEach(() => {
        root?.unmount();
        root = null;
        container.remove();
    });

    test("renders cropped login logo in a client-list control", async () => {
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(TopNav, {
                    active: "Clients",
                    onNavigate: () => {},
                    onOpenPrescription: () => {},
                }),
            );
        });
        const control = container.querySelector('button[aria-label="Back to client list"]');
        expect(control).toBeTruthy();
        const img = control?.querySelector("img");
        expect(img?.getAttribute("src")).toBe("/brand/orthocad-logo-header.png");
        expect(img?.className).toContain("h-9");
    });

    test("navigates to the client list when clicked without a guard", async () => {
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(TopNav, {
                    active: "Clients",
                    onNavigate: () => {},
                    onOpenPrescription: () => {},
                }),
            );
        });
        const control = container.querySelector('button[aria-label="Back to client list"]') as HTMLButtonElement;
        control.click();
        expect(navigateMock.mock.calls.length).toBe(1);
        expect(navigateMock.mock.calls[0]?.[0]).toBe("/clients");
    });

    test("uses onLogoNavigate instead of direct navigation when provided", async () => {
        const onLogoNavigate = rs.fn();
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(TopNav, {
                    active: "Clients",
                    onNavigate: () => {},
                    onOpenPrescription: () => {},
                    onLogoNavigate,
                }),
            );
        });
        const control = container.querySelector('button[aria-label="Back to client list"]') as HTMLButtonElement;
        control.click();
        expect(onLogoNavigate.mock.calls.length).toBe(1);
        expect(navigateMock.mock.calls.length).toBe(0);
    });
});

describe("TopNav super-admin link", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        useAuthStore.setState({ user: null, license: null, loading: false });
        navigateMock.mockReset();
    });

    afterEach(() => {
        root?.unmount();
        root = null;
        container.remove();
        useAuthStore.setState({ user: null, license: null, loading: true });
    });

    test("hides Super admin for clinician", async () => {
        useAuthStore.setState({ user: clinician, loading: false });
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(TopNav, {
                    active: "Clients",
                    onNavigate: () => {},
                    onOpenPrescription: () => {},
                }),
            );
        });
        expect(container.textContent).not.toContain("Super admin");
    });

    test("shows Super admin in the header for super_admin", async () => {
        useAuthStore.setState({ user: superAdmin, loading: false });
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(TopNav, {
                    active: "Clients",
                    onNavigate: () => {},
                    onOpenPrescription: () => {},
                }),
            );
        });
        expect(container.textContent).toContain("Super admin");
        expect(container.textContent).toContain("Production");
        expect(container.textContent).not.toContain("Orders");
    });
});
