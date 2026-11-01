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

    test("jobs run one at a time in priority order", async () => {
        const order: string[] = [];
        let releaseLeft: (() => void) | undefined;
        const leftGate = new Promise<void>((resolve) => {
            releaseLeft = resolve;
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 0,
            run: async () => {
                await leftGate;
                order.push("left");
            },
        });
        enqueuePreviewLoft({
            side: "right",
            priority: 10,
            run: () => {
                order.push("right");
            },
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual([]);
        expect(previewLoftQueueSnapshotForTests().pending).toContain("right");
        releaseLeft?.();
        await new Promise((r) => setTimeout(r, 40));
        expect(order).toEqual(["left", "right"]);
    });

    test("cancelled jobs never run", async () => {
        const order: string[] = [];
        let releaseLeft: (() => void) | undefined;
        const leftGate = new Promise<void>((resolve) => {
            releaseLeft = resolve;
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 0,
            run: async () => {
                await leftGate;
                order.push("left");
            },
        });
        const handle = enqueuePreviewLoft({
            side: "right",
            priority: 1,
            run: () => {
                order.push("right");
            },
        });
        handle.cancel();
        releaseLeft?.();
        await new Promise((r) => setTimeout(r, 40));
        expect(order).toEqual(["left"]);
    });

    test("cancelAllPreviewLofts drops queued jobs", async () => {
        const order: string[] = [];
        let releaseLeft: (() => void) | undefined;
        const leftGate = new Promise<void>((resolve) => {
            releaseLeft = resolve;
        });
        enqueuePreviewLoft({
            side: "left",
            priority: 0,
            run: async () => {
                await leftGate;
                order.push("left");
            },
        });
        enqueuePreviewLoft({
            side: "right",
            priority: 1,
            run: () => {
                order.push("right");
            },
        });
        cancelAllPreviewLofts();
        releaseLeft?.();
        await new Promise((r) => setTimeout(r, 40));
        expect(order).not.toContain("right");
        expect(previewLoftQueueSnapshotForTests().pending).toEqual([]);
    });
});
