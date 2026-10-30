// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UserProfile } from "@/types";
import { AccountMenu } from "./AccountMenu";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

describe("AccountMenu super-admin link", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        root?.unmount();
        root = null;
        container.remove();
    });

    test("clinician account menu has no Super admin link", async () => {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(AccountMenu, { user: clinician }));
        });
        await act(async () => {
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(container.textContent).not.toContain("Super admin");
    });

    test("super_admin account menu includes Super admin link", async () => {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(AccountMenu, { user: superAdmin }));
        });
        await act(async () => {
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(container.textContent).toContain("Super admin");
    });
});
