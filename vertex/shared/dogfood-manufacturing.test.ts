import { describe, expect, test } from "@rstest/core";

import { assertDogfoodNotHeld } from "./dogfood-holds.js";
import { decideDogfoodHardness } from "./dogfood-manufacturing.js";
import { assertNoForbiddenOrderStatus } from "./forbidden-order-status.js";

describe("dogfood hardness and status guards", () => {
    test("omitted hardness asks the user and does not pick Medium", () => {
        const decision = decideDogfoodHardness({ provenance: null, requested: undefined });
        expect(decision.ok).toBe(false);
        if (!decision.ok) {
            expect(decision.ask).toBe("user");
            expect(decision.relay).toBe("none");
            expect(decision.questions[0]?.field).toBe("hardness");
            expect(decision.questions[0]?.prompt).not.toMatch(/^Medium$/);
        }
    });

    test("a prescribed hardness is used and an unknown name asks", () => {
        const prescribed = decideDogfoodHardness({
            provenance: { hardness: "Hard", hardnessSource: "prescribed" },
            requested: undefined,
        });
        expect(prescribed).toEqual({ ok: true, hardness: "Hard", source: "prescribed" });
        const requested = decideDogfoodHardness({
            provenance: null,
            requested: "extra soft",
        });
        expect(requested).toEqual({ ok: true, hardness: "Extra Soft", source: "requested" });
        const unknown = decideDogfoodHardness({ provenance: null, requested: "99A" });
        expect(unknown.ok).toBe(false);
    });

    test("handoffs cannot carry a forbidden order status", () => {
        expect(() => assertNoForbiddenOrderStatus({ order_id: "ok", files: [] })).not.toThrow();
        for (const status of ["Production", "In Production", "Ready to Ship", "Shipped", "File Ready"]) {
            expect(() => assertNoForbiddenOrderStatus({ label: status })).toThrow(/order status/);
        }
        expect(() => assertNoForbiddenOrderStatus({ status: "Waiting" })).toThrow(/not part of this payload/);
    });

    test("a synthetic held prefix is refused without reading an order", () => {
        expect(() => assertDogfoodNotHeld("order-ok", ["held-prefix"])).not.toThrow();
        expect(() => assertDogfoodNotHeld("held-prefix-1", ["held-prefix"])).toThrow(/on hold/);
    });
});
