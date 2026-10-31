// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    applyLedgerWrite,
    assertLedgerBalanced,
    buildAuditEntry,
} from "../../../shared/admin/admin-domain.js";

describe("append-only admin writes", () => {
    test("grant then undo is two ledger rows whose amounts sum to the original balance", () => {
        const grant = applyLedgerWrite([], { type: "grant", amount: 80, reason: "Purchase" });
        const undo = applyLedgerWrite([grant], {
            type: "adjustment",
            amount: -80,
            reason: "Undo grant",
        });
        expect(grant.balanceAfter).toBe(80);
        expect(undo.balanceAfter).toBe(0);
        expect(assertLedgerBalanced([grant, undo])).toBe(0);
    });

    test("audit helper never emits an entry without a reason", () => {
        expect(() => buildAuditEntry({ action: "tenant.suspended", reason: "   " })).toThrow(/reason/);
    });
});
