// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LoginScreen } from "./LoginScreen";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function setInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

const signInWithPassword = rs.fn(async () => ({ error: null }));

rs.mock("@/lib/supabase", () => ({
    getSupabase: () => ({
        auth: { signInWithPassword },
    }),
}));

describe("LoginScreen", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        signInWithPassword.mockClear();
    });

    afterEach(() => {
        root?.unmount();
        root = null;
        container.remove();
    });

    async function renderLogin() {
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(LoginScreen));
        });
    }

    test("shows modern lockup, copy, and footer without legacy dev chrome", async () => {
        await renderLogin();
        expect(container.querySelector('img[src="/brand/orthocad-logo-dark.png"]')).toBeTruthy();
        expect(container.textContent).toContain("Sign in");
        expect(container.textContent).toContain("Use your Vertex account");
        expect(container.textContent).toContain("© 2026 Vertex Orthopedic Group");
        expect(container.textContent).not.toContain("Roles:");
        expect(container.textContent).not.toContain("Supabase Auth");
        expect(container.textContent).not.toContain("Dev super_admin");
    });

    test("starts with empty fields and validates before Supabase sign-in", async () => {
        await renderLogin();
        const email = container.querySelector('input[type="email"]') as HTMLInputElement;
        const password = container.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
        expect(email.value).toBe("");
        expect(password.value).toBe("");

        const form = container.querySelector("form") as HTMLFormElement;
        await act(async () => {
            form.requestSubmit();
        });
        expect(signInWithPassword).not.toHaveBeenCalled();
        expect(container.textContent).toContain("Enter your email.");

        await act(async () => {
            setInputValue(email, "clinician@example.com");
        });
        await act(async () => {
            form.requestSubmit();
        });
        expect(container.textContent).toContain("Enter your password.");
    });

    test("toggles password visibility via the eye control", async () => {
        await renderLogin();
        const password = container.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
        const toggle = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
        expect(password.type).toBe("password");
        await act(async () => {
            toggle.click();
        });
        expect(password.type).toBe("text");
        expect(container.querySelector('button[aria-label="Hide password"]')).toBeTruthy();
    });

    test("submits credentials to Supabase when fields are filled", async () => {
        await renderLogin();
        const email = container.querySelector('input[type="email"]') as HTMLInputElement;
        const password = container.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
        await act(async () => {
            setInputValue(email, "clinician@example.com");
            setInputValue(password, "secret");
        });
        await act(async () => {
            (container.querySelector("form") as HTMLFormElement).requestSubmit();
        });
        expect(signInWithPassword).toHaveBeenCalledWith({
            email: "clinician@example.com",
            password: "secret",
        });
    });
});
