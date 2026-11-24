// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    createSlicerCheckout,
    type SlicerCheckoutSessionInput,
    type SlicerStripe,
    sealSliceFiles,
    slicerUnitAmountCents,
    unlockSlicerDownload,
} from "./slicer-pay";

const USER = { id: "user-1", email: "clinic@example.com" };

function sealEnv() {
    return { SLICER_SEAL_SECRET: "test-seal" };
}

function fakeStripe(overrides?: Partial<SlicerStripe> & { paid?: boolean }): {
    stripe: SlicerStripe;
    created: SlicerCheckoutSessionInput[];
} {
    const created: SlicerCheckoutSessionInput[] = [];
    const stripe: SlicerStripe = {
        findCustomerIdByEmail: async () => "cus_existing",
        createCustomer: async () => "cus_created",
        createPaymentSession: async (input) => {
            created.push(input);
            return { id: "cs_test_1", url: "https://checkout.stripe.test/c/cs_test_1" };
        },
        retrievePaymentSession: async () => {
            const session = created[0];
            return {
                payment_status: overrides?.paid ? "paid" : "unpaid",
                mode: "payment",
                amount_total: session ? session.unitAmountCents * session.fileCount : 0,
                metadata: session?.metadata ?? null,
                customerId: session?.customerId ?? null,
            };
        },
        ...overrides,
    };
    return { stripe, created };
}

describe("slicer checkout", () => {
    test("default price is $8 per file and can be overridden by env", () => {
        expect(slicerUnitAmountCents({})).toBe(800);
        expect(slicerUnitAmountCents({ SLICER_PRICE_USD_PER_FILE: "12.5" })).toBe(1250);
    });

    test("checkout session uses the customer id and $8 per file", async () => {
        const env = { ...sealEnv(), STRIPE_SECRET_KEY: "sk_test_dummy" };
        const left = sealSliceFiles([{ filename: "left.gcode", gcode: "; left\nG1 X0\n" }], env);
        const right = sealSliceFiles([{ filename: "right.gcode", gcode: "; right\nG1 X1\n" }], env);
        const { stripe, created } = fakeStripe();
        const result = await createSlicerCheckout({
            stripe,
            user: USER,
            seals: [left, right],
            successUrl: "https://orthocad.example/slicer/checkout-return?session_id={CHECKOUT_SESSION_ID}",
            cancelUrl: "https://orthocad.example/slicer?checkout=cancelled",
            env,
        });
        expect(result.ok).toBe(true);
        if (!result.ok || result.mock) throw new Error("expected a live checkout");
        expect(result.url).toContain("checkout.stripe.test");
        expect(created).toHaveLength(1);
        expect(created[0]?.customerId).toBe("cus_existing");
        expect(created[0]?.unitAmountCents).toBe(800);
        expect(created[0]?.fileCount).toBe(2);
        expect(created[0]?.metadata.payment_type).toBe("slicer_gcode");
        expect(created[0]?.metadata.orthocad_user_id).toBe(USER.id);
        expect(JSON.stringify(created[0])).not.toContain("sk_test_dummy");
    });

    test("creates a customer when the email is new", async () => {
        const env = { ...sealEnv(), STRIPE_SECRET_KEY: "sk_test_dummy" };
        const sealed = sealSliceFiles([{ filename: "insole.gcode", gcode: "G1 X0\n" }], env);
        const { stripe, created } = fakeStripe({
            findCustomerIdByEmail: async () => null,
        });
        const result = await createSlicerCheckout({
            stripe,
            user: USER,
            seals: [sealed],
            successUrl: "https://orthocad.example/slicer/checkout-return?session_id={CHECKOUT_SESSION_ID}",
            cancelUrl: "https://orthocad.example/slicer?checkout=cancelled",
            env,
        });
        expect(result.ok).toBe(true);
        expect(created[0]?.customerId).toBe("cus_created");
        expect(created[0]?.unitAmountCents).toBe(800);
        expect(created[0]?.fileCount).toBe(1);
    });

    test("download is refused without a paid session and allowed after payment", async () => {
        const env = { ...sealEnv(), STRIPE_SECRET_KEY: "sk_test_dummy" };
        const sealed = sealSliceFiles([{ filename: "insole.gcode", gcode: "; material = ApexCore\n" }], env);
        const unpaid = fakeStripe({ paid: false });
        await createSlicerCheckout({
            stripe: unpaid.stripe,
            user: USER,
            seals: [sealed],
            successUrl: "https://orthocad.example/slicer/checkout-return?session_id={CHECKOUT_SESSION_ID}",
            cancelUrl: "https://orthocad.example/slicer?checkout=cancelled",
            env,
        });
        const missing = await unlockSlicerDownload({
            stripe: unpaid.stripe,
            user: USER,
            sealed,
            sessionId: "",
            env,
        });
        expect(missing.ok).toBe(false);
        const refused = await unlockSlicerDownload({
            stripe: unpaid.stripe,
            user: USER,
            sealed,
            sessionId: "cs_test_1",
            env,
        });
        expect(refused.ok).toBe(false);

        const paid = fakeStripe({ paid: true });
        const session = unpaid.created[0];
        if (!session) throw new Error("expected a checkout session");
        paid.created.push(session);
        const opened = await unlockSlicerDownload({
            stripe: paid.stripe,
            user: USER,
            sealed,
            sessionId: "cs_test_1",
            env,
        });
        expect(opened.ok).toBe(true);
        if (opened.ok) expect(opened.files[0]?.gcode).toContain("; material = ApexCore");
    });

    test("mock checkout and download work when Stripe and VertexSlice env are unset", async () => {
        const env = {};
        const sealed = sealSliceFiles([{ filename: "insole.gcode", gcode: "G28\n" }], env);
        const checkout = await createSlicerCheckout({
            stripe: null,
            user: USER,
            seals: [sealed],
            successUrl: "http://localhost/slicer/checkout-return?session_id={CHECKOUT_SESSION_ID}",
            cancelUrl: "http://localhost/slicer?checkout=cancelled",
            env,
        });
        expect(checkout.ok).toBe(true);
        if (!checkout.ok || !checkout.mock) throw new Error("expected mock checkout");
        expect(checkout.unitAmountCents).toBe(800);
        const refused = await unlockSlicerDownload({
            stripe: null,
            user: USER,
            sealed,
            sessionId: "",
            env,
        });
        expect(refused.ok).toBe(false);
        const opened = await unlockSlicerDownload({
            stripe: null,
            user: USER,
            sealed,
            sessionId: checkout.sessionId,
            env,
        });
        expect(opened.ok).toBe(true);
        if (opened.ok) expect(opened.files[0]?.gcode).toBe("G28\n");
    });
});
