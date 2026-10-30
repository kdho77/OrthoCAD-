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

describe("TopNav super-admin link", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        useAuthStore.setState({ user: null, license: null, loading: false });
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
                    active: "Production",
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
                    active: "Production",
                    onNavigate: () => {},
                    onOpenPrescription: () => {},
                }),
            );
        });
        expect(container.textContent).toContain("Super admin");
    });
});
