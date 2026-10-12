// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, describe, expect, test } from "@rstest/core";
import {
    cancelAllPreviewLofts,
    enqueuePreviewLoft,
    previewLoftPriority,
    previewLoftQueueSnapshotForTests,
    resetPreviewLoftQueueForTests,
} from "./preview-loft-queue";

afterEach(() => {
    resetPreviewLoftQueueForTests();
});

describe("preview loft queue", () => {
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
