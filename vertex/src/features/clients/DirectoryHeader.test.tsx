// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthStore } from "@/stores/auth-store";
import type { UserProfile } from "@/types";
import { DirectoryHeader } from "./DirectoryHeader";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const superAdmin: UserProfile = {
    id: "s1",
    email: "kdho@vertexorthopedic.com",
    fullName: "Kendon",
    role: "super_admin",
    tokenBalance: 10,
};

describe("DirectoryHeader phone nav", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        useAuthStore.setState({ user: superAdmin, license: null, loading: false });
    });

    afterEach(() => {
        root?.unmount();
        root = null;
        container.remove();
        useAuthStore.setState({ user: null, license: null, loading: true });
    });

    test("shows Clients, Production, and Super admin without clipping styles", async () => {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(DirectoryHeader, { active: "Clients" }));
        });
        expect(container.textContent).toContain("Clients");
        expect(container.textContent).toContain("Production");
        expect(container.textContent).toContain("Super admin");
        const nav = container.querySelector("nav");
        expect(nav?.className).toContain("overflow-x-auto");
        expect(nav?.querySelectorAll("button").length).toBeGreaterThanOrEqual(3);
    });
});
