// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import {
    cancelAllPreviewLofts,
    enqueuePreviewLoft,
    previewLoftPriority,
    previewLoftQueueSnapshotForTests,
    resetPreviewLoftQueueForTests,
    yieldToMain,
} from "./preview-loft-queue";

afterEach(() => {
    resetPreviewLoftQueueForTests();
});

describe("preview loft queue", () => {
    test("yieldToMain returns control to the event loop", async () => {
        let continued = false;
        const p = yieldToMain().then(() => {
            continued = true;
        });
        expect(continued).toBe(false);
        await p;
        expect(continued).toBe(true);
    });

    test("previewLoftPriority runs the active foot first and parks the mobile mirror", () => {
        expect(previewLoftPriority("left", "left", false)).toBe(0);
        expect(previewLoftPriority("right", "left", false)).toBe(1);
        expect(previewLoftPriority("right", "left", true)).toBe(10);
        expect(previewLoftPriority("left", "right", true)).toBe(10);
    });

    test("left and right run at the same time", async () => {
        const order: string[] = [];
        let started = 0;
        let releaseBoth: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            releaseBoth = resolve;
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 0,
            run: async () => {
                started += 1;
                await gate;
                order.push("left");
            },
        });
        enqueuePreviewLoft({
            side: "right",
            priority: 1,
            run: async () => {
                started += 1;
                await gate;
                order.push("right");
            },
        });
        await new Promise((r) => setTimeout(r, 30));
        expect(started).toBe(2);
        expect(previewLoftQueueSnapshotForTests().running.sort()).toEqual(["left", "right"]);
        expect(previewLoftQueueSnapshotForTests().pending).toEqual([]);
        releaseBoth?.();
        await new Promise((r) => setTimeout(r, 40));
        expect(order.sort()).toEqual(["left", "right"]);
    });

    test("a third job waits until a worker slot is free", async () => {
        const order: string[] = [];
        let releaseBoth: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            releaseBoth = resolve;
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 0,
            run: async () => {
                await gate;
                order.push("left");
            },
        });
        enqueuePreviewLoft({
            side: "right",
            priority: 1,
            run: async () => {
                await gate;
                order.push("right");
            },
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 2,
            run: () => {
                order.push("again");
            },
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(previewLoftQueueSnapshotForTests().pending).toEqual(["left"]);
        expect(order).toEqual([]);
        releaseBoth?.();
        await new Promise((r) => setTimeout(r, 50));
        expect(order).toEqual(["left", "right", "again"]);
    });

    test("a cancelled job that has not started never runs", async () => {
        const order: string[] = [];
        let releaseBoth: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            releaseBoth = resolve;
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 0,
            run: async () => {
                await gate;
                order.push("left");
            },
        });
        enqueuePreviewLoft({
            side: "right",
            priority: 1,
            run: async () => {
                await gate;
                order.push("right");
            },
        });
        const handle = enqueuePreviewLoft({
            side: "left",
            priority: 2,
            run: () => {
                order.push("third");
            },
        });
        handle.cancel();
        releaseBoth?.();
        await new Promise((r) => setTimeout(r, 50));
        expect(order).not.toContain("third");
        expect(previewLoftQueueSnapshotForTests().pending).toEqual([]);
    });

    test("cancelAllPreviewLofts drops jobs that have not started", async () => {
        const order: string[] = [];
        let releaseBoth: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            releaseBoth = resolve;
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 0,
            run: async () => {
                await gate;
                order.push("left");
            },
        });
        enqueuePreviewLoft({
            side: "right",
            priority: 1,
            run: async () => {
                await gate;
                order.push("right");
            },
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 2,
            run: () => {
                order.push("third");
            },
        });
        cancelAllPreviewLofts();
        releaseBoth?.();
        await new Promise((r) => setTimeout(r, 50));
        expect(order).not.toContain("third");
        expect(previewLoftQueueSnapshotForTests().pending).toEqual([]);
    });
});
