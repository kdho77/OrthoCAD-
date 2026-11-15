// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NewClientDialog } from "./NewClientDialog";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

rs.mock("@/components/ui/dialog", () => ({
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
        open ? createElement("div", { "data-testid": "dialog-root" }, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) => createElement("h2", null, children),
}));

function queryDialog(): ParentNode {
    return document.querySelector('[data-testid="dialog-root"]') ?? document.body;
}

function setInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    descriptor?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillValidCreateForm(rootNode: ParentNode, displayName = "Jane Doe") {
    const name = rootNode.querySelector('[aria-label="Display name or initials"]') as HTMLInputElement;
    const size = rootNode.querySelector('[data-testid="shoe-size"]') as HTMLSelectElement;
    setInputValue(name, displayName);
    setSelectValue(size, "10");
}

describe("NewClientDialog create client", () => {
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

    test("blocks save until shoe size is valid and shows an error after submit", async () => {
        const onSubmit = rs.fn();
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(NewClientDialog, {
                    open: true,
                    mode: "create",
                    clients: [],
                    onClose: () => {},
                    onSubmit,
                    onOpenExisting: () => {},
                }),
            );
        });

        const rootNode = queryDialog();
        const name = rootNode.querySelector('[aria-label="Display name or initials"]') as HTMLInputElement;
        const size = rootNode.querySelector('[data-testid="shoe-size"]') as HTMLSelectElement;
        expect(name).not.toBeNull();
        expect(size).not.toBeNull();

        await act(async () => {
            setInputValue(name, "Jane Doe");
        });

        await act(async () => {
            setSelectValue(size, "");
        });

        const buttons = Array.from(rootNode.querySelectorAll("button")).filter((node) =>
            /Save|Launch/.test(node.textContent ?? ""),
        );
        expect(buttons.every((node) => (node as HTMLButtonElement).disabled)).toBe(true);
        expect(rootNode.querySelector('[data-testid="shoe-size-error"]')?.textContent).toContain("1 and 16");
        expect(onSubmit).not.toHaveBeenCalled();
    });

    test("renders separate left and right size fields when split is enabled", async () => {
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(NewClientDialog, {
                    open: true,
                    mode: "create",
                    clients: [],
                    onClose: () => {},
                    onSubmit: () => {},
                    onOpenExisting: () => {},
                }),
            );
        });

        const rootNode = queryDialog();
        const split = rootNode.querySelector('[data-testid="shoe-size-split"]') as HTMLInputElement;
        expect(split).not.toBeNull();
        await act(async () => {
            split.click();
        });
        expect(rootNode.querySelector('[data-testid="shoe-size-left"]')).not.toBeNull();
        expect(rootNode.querySelector('[data-testid="shoe-size-right"]')).not.toBeNull();
    });

    test("shows an inline error and keeps the dialog open when save is rejected", async () => {
        const onSubmit = rs.fn(async () => {
            throw new Error("Internal Server Error");
        });
        const onClose = rs.fn();
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(NewClientDialog, {
                    open: true,
                    mode: "create",
                    clients: [],
                    onClose,
                    onSubmit,
                    onOpenExisting: () => {},
                }),
            );
        });

        const rootNode = queryDialog();
        await act(async () => {
            fillValidCreateForm(rootNode);
        });

        const saveButton = Array.from(rootNode.querySelectorAll("button")).find((node) =>
            (node.textContent ?? "").trim().startsWith("Save"),
        ) as HTMLButtonElement;
        await act(async () => {
            saveButton.click();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(rootNode.querySelector('[data-testid="client-submit-error"]')?.textContent).toBe(
            "Couldn't save the client. Please try again.",
        );
        const name = rootNode.querySelector('[aria-label="Display name or initials"]') as HTMLInputElement;
        expect(name.value).toBe("Jane Doe");
        const buttons = Array.from(rootNode.querySelectorAll("button")).filter((node) =>
            /Save|Launch/.test(node.textContent ?? ""),
        );
        expect(buttons.every((node) => !(node as HTMLButtonElement).disabled)).toBe(true);
    });

    test("calls onSubmit with design intent and leaves closing to the parent on success", async () => {
        let open = true;
        const onClose = rs.fn(() => {
            open = false;
        });
        const onSubmit = rs.fn(async () => {
            open = false;
        });
        await act(async () => {
            root = createRoot(container);
            root.render(
                createElement(NewClientDialog, {
                    open,
                    mode: "create",
                    clients: [],
                    onClose,
                    onSubmit,
                    onOpenExisting: () => {},
                }),
            );
        });

        const rootNode = queryDialog();
        await act(async () => {
            fillValidCreateForm(rootNode, "Launch Me");
        });

        const designButton = rootNode.querySelector('[data-testid="create-and-design"]') as HTMLButtonElement;
        await act(async () => {
            designButton.click();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                displayName: "Launch Me",
                shoeSizeUs: 10,
            }),
            "design",
        );
        expect(rootNode.querySelector('[data-testid="client-submit-error"]')).toBeNull();

        await act(async () => {
            root?.render(
                createElement(NewClientDialog, {
                    open: false,
                    mode: "create",
                    clients: [],
                    onClose,
                    onSubmit,
                    onOpenExisting: () => {},
                }),
            );
        });
        expect(document.querySelector('[data-testid="dialog-root"]')).toBeNull();
    });
});
