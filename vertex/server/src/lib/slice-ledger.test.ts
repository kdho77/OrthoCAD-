// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { SLICE_TOKEN_COST } from "../../../shared/slice-job";
import { MemorySliceLedger } from "./slice-ledger";

const userId = "11111111-1111-4111-8111-111111111111";

function ledgerWithBalance(balance: number): MemorySliceLedger {
    const ledger = new MemorySliceLedger();
    ledger.setBalance(userId, balance);
    return ledger;
}

function queuedInput(idempotencyKey: string) {
    return {
        userId,
        idempotencyKey,
        profileId: "apex-belt-v2",
        material: "TPU 95A",
        side: "left" as const,
        stlStorageKey: `manufacturing-temp/${userId}/model.stl`,
    };
}

describe("slice token ledger", () => {
    test("double-submit of the same idempotency key is one job and one charge", async () => {
        const ledger = ledgerWithBalance(5);
        const first = await ledger.insertQueued(queuedInput("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
        const second = await ledger.insertQueued(queuedInput("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.job.id).toBe(first.job.id);

        await ledger.claimRunning(first.job.id);
        const settled = await ledger.settleSuccess(first.job.id, { gcodeStorageKey: "gcode/one.gcode" });
        const again = await ledger.settleSuccess(first.job.id, { gcodeStorageKey: "gcode/two.gcode" });

        expect(settled.charged).toBe(true);
        expect(again.charged).toBe(false);
        expect(ledger.charges).toHaveLength(1);
        expect(ledger.charges[0]?.amount).toBe(SLICE_TOKEN_COST);
        expect(await ledger.getBalance(userId)).toBe(4);
        expect((await ledger.getById(first.job.id))?.tokenCost).toBe(1);
    });

    test("a failed slice charges nothing", async () => {
        const ledger = ledgerWithBalance(3);
        const { job } = await ledger.insertQueued(queuedInput("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
        await ledger.claimRunning(job.id);
        const failed = await ledger.markFailed(job.id, "slicer exploded");
        const settled = await ledger.settleSuccess(job.id, { gcodeStorageKey: "gcode/ignored.gcode" });

        expect(failed.status).toBe("failed");
        expect(failed.charged).toBe(false);
        expect(failed.tokenCost).toBe(0);
        expect(settled.charged).toBe(false);
        expect(ledger.charges).toHaveLength(0);
        expect(await ledger.getBalance(userId)).toBe(3);
    });

    test("concurrent success transitions charge exactly once", async () => {
        const ledger = ledgerWithBalance(8);
        const { job } = await ledger.insertQueued(queuedInput("cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
        await ledger.claimRunning(job.id);

        const [a, b] = await Promise.all([
            ledger.settleSuccess(job.id, { gcodeStorageKey: "gcode/a.gcode" }),
            ledger.settleSuccess(job.id, { gcodeStorageKey: "gcode/b.gcode" }),
        ]);

        const charged = [a, b].filter((result) => result.charged);
        expect(charged).toHaveLength(1);
        expect(ledger.charges).toHaveLength(1);
        expect(await ledger.getBalance(userId)).toBe(7);
        expect((await ledger.getById(job.id))?.status).toBe("succeeded");
    });

    test("concurrent inserts of one key create a single job", async () => {
        const ledger = ledgerWithBalance(2);
        const key = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const [a, b] = await Promise.all([
            ledger.insertQueued(queuedInput(key)),
            ledger.insertQueued(queuedInput(key)),
        ]);
        expect(a.job.id).toBe(b.job.id);
        expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    });

    test("a slice that outlives the timeout is failed with no charge", async () => {
        const ledger = ledgerWithBalance(4);
        const { job } = await ledger.insertQueued(queuedInput("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"));
        await ledger.claimRunning(job.id);
        ledger.rewindCreatedAt(job.id, new Date(Date.now() - 11 * 60 * 1000).toISOString());
        const settled = await ledger.settleSuccess(job.id, { gcodeStorageKey: "gcode/late.gcode" });
        expect(settled.charged).toBe(false);
        expect(settled.job.status).toBe("failed");
        expect(settled.job.error).toBe("timeout");
        expect(await ledger.getBalance(userId)).toBe(4);
    });

    test("markFailed does not undo a charge that already landed", async () => {
        const ledger = ledgerWithBalance(2);
        const { job } = await ledger.insertQueued(queuedInput("ffffffff-ffff-4fff-8fff-ffffffffffff"));
        await ledger.claimRunning(job.id);
        await ledger.settleSuccess(job.id, { gcodeStorageKey: "gcode/ok.gcode" });
        const after = await ledger.markFailed(job.id, "late failure");
        expect(after.status).toBe("succeeded");
        expect(after.charged).toBe(true);
        expect(await ledger.getBalance(userId)).toBe(1);
    });
});
