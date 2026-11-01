// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { DesignNotesField } from "./DesignNotesField";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("design notes autosave", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;

    afterEach(() => {
        act(() => {
            root?.unmount();
        });
        root = null;
        container.remove();
    });

    test("blur commits and escape reverts to the last saved text", () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        const commits: string[] = [];
        act(() => {
            root = createRoot(container);
            root.render(createElement(DesignNotesField, { value: "kept", onCommit: (notes) => commits.push(notes) }));
        });
        const field = container.querySelector("textarea");
        if (!field) throw new Error("notes field missing");

        act(() => {
            Simulate.change(field, { target: { value: "edited" } } as unknown as React.ChangeEvent<HTMLTextAreaElement>);
        });
        act(() => {
            Simulate.keyDown(field, { key: "Escape" });
        });
        expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("kept");
        expect(commits).toEqual([]);

        act(() => {
            Simulate.change(field, { target: { value: "Heel note" } } as unknown as React.ChangeEvent<HTMLTextAreaElement>);
        });
        act(() => {
            Simulate.blur(field);
        });
        expect(commits).toEqual(["Heel note"]);
        expect(container.textContent).toContain("Saved");
    });
});
