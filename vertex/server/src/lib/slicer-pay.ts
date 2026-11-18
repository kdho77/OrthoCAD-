// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";
import Stripe from "stripe";

/** Charged when SLICER_PRICE_USD_PER_FILE is unset. */
export const DEFAULT_SLICER_PRICE_USD_PER_FILE = 8;

const MAX_FILES = 2;
const MOCK_SESSION_TTL_MS = 30 * 60 * 1000;

export interface SlicerPayEnv {
    STRIPE_SECRET_KEY?: string;
    SLICER_PRICE_USD_PER_FILE?: string;
    SLICER_SEAL_SECRET?: string;
}

export interface SealedSliceFile {
    filename: string;
    gcode: string;
}

export interface SlicerCheckoutSessionInput {
    customerId: string;
    unitAmountCents: number;
    fileCount: number;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
}

export interface SlicerPaidSession {
    payment_status: string;
    mode: string | null;
    amount_total: number | null;
    metadata: Record<string, string> | null;
    customerId: string | null;
}

/**
 * Narrow Stripe surface used by /slicer. Tests pass a fake. Production uses
 * the same Checkout shape as VertexOrders: mode=payment and customer set so
 * saved cards on that Stripe customer are offered.
 */
export interface SlicerStripe {
    findCustomerIdByEmail(email: string): Promise<string | null>;
    createCustomer(input: { email: string; metadata: Record<string, string> }): Promise<string>;
    createPaymentSession(input: SlicerCheckoutSessionInput): Promise<{ id: string; url: string | null }>;
    retrievePaymentSession(sessionId: string): Promise<SlicerPaidSession>;
}

export function stripeConfigured(env: SlicerPayEnv = process.env): boolean {
    return Boolean(env.STRIPE_SECRET_KEY?.trim());
}

export function slicerUnitAmountCents(env: SlicerPayEnv = process.env): number {
    const raw = env.SLICER_PRICE_USD_PER_FILE?.trim();
    const dollars = raw ? Number(raw) : DEFAULT_SLICER_PRICE_USD_PER_FILE;
    if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 10000) {
        throw new Error("SLICER_PRICE_USD_PER_FILE is invalid");
    }
    const cents = Math.round(dollars * 100);
    if (cents < 50) throw new Error("SLICER_PRICE_USD_PER_FILE is below the Stripe minimum");
    return cents;
}

function sealKey(env: SlicerPayEnv): Buffer {
    const dedicated = env.SLICER_SEAL_SECRET?.trim();
    if (dedicated) return createHash("sha256").update(dedicated).digest();
    const stripeKey = env.STRIPE_SECRET_KEY?.trim();
    if (stripeKey) return createHash("sha256").update(`orthocad-slicer-seal:${stripeKey}`).digest();
    return createHash("sha256").update("orthocad-slicer-mock-seal").digest();
}

export function sealSliceFiles(files: SealedSliceFile[], env: SlicerPayEnv = process.env): string {
    if (files.length !== 1 || !files[0]?.gcode || !files[0]?.filename) {
        throw new Error("A slice seal holds one file");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", sealKey(env), iv);
    const plaintext = Buffer.from(JSON.stringify({ v: 1, files }), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function openSliceSeal(sealed: string, env: SlicerPayEnv = process.env): SealedSliceFile[] {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 12 + 16 + 1) throw new Error("Slice seal is invalid");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", sealKey(env), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as { v?: number; files?: SealedSliceFile[] };
    if (parsed.v !== 1 || !Array.isArray(parsed.files) || parsed.files.length !== 1) {
        throw new Error("Slice seal is invalid");
    }
    const file = parsed.files[0];
    if (!file || typeof file.gcode !== "string" || typeof file.filename !== "string" || !file.gcode) {
        throw new Error("Slice seal is invalid");
    }
    return [{ filename: file.filename, gcode: file.gcode }];
}

export function sealHash(sealed: string): string {
    return createHash("sha256").update(sealed).digest("hex");
}

function mockMac(body: string): string {
    return createHmac("sha256", sealKey({})).update(body).digest("base64url");
}

function issueMockSession(input: {
    userId: string;
    hashes: string[];
    amountCents: number;
    now: number;
}): string {
    const body = Buffer.from(
        JSON.stringify({
            uid: input.userId,
            hashes: input.hashes,
            amount: input.amountCents,
            exp: input.now + MOCK_SESSION_TTL_MS,
        }),
    ).toString("base64url");
    return `mock_${body}.${mockMac(body)}`;
}

function readMockSession(
    sessionId: string,
    now: number,
): {
    uid: string;
    hashes: string[];
    amount: number;
    exp: number;
} | null {
    if (!sessionId.startsWith("mock_")) return null;
    const token = sessionId.slice("mock_".length);
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = mockMac(body);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
            uid?: string;
            hashes?: string[];
            amount?: number;
            exp?: number;
        };
        if (
            !parsed.uid ||
            !Array.isArray(parsed.hashes) ||
            typeof parsed.amount !== "number" ||
            typeof parsed.exp !== "number"
        ) {
            return null;
        }
        if (parsed.exp < now) return null;
        return { uid: parsed.uid, hashes: parsed.hashes, amount: parsed.amount, exp: parsed.exp };
    } catch {
        return null;
    }
}

export function publicPayError(err: unknown, secret?: string): string {
    let message = err instanceof Error ? err.message : "Payment failed";
    if (secret) message = message.split(secret).join("[redacted]");
    message = message.replace(/\bsk_(?:live|test)_[A-Za-z0-9]+/g, "[redacted]");
    return message.slice(0, 300);
}

/**
 * Reuse a Stripe customer by email so a VertexOrders clinic sees saved cards.
 * Create one only when the email has no customer yet. Do not overwrite metadata
 * on a customer VertexOrders already uses.
 */
export async function ensureStripeCustomerByEmail(
    stripe: SlicerStripe,
    user: { id: string; email: string },
): Promise<string> {
    const email = user.email.trim();
    if (!email.includes("@") || email.toLowerCase().endsWith("@placeholder.invalid")) {
        throw new Error("Sign in with an email address to pay");
    }
    const existing = await stripe.findCustomerIdByEmail(email);
    if (existing) return existing;
    return stripe.createCustomer({
        email,
        metadata: { orthocad_user_id: user.id, source: "orthocad_slicer" },
    });
}

export function liveSlicerStripe(env: SlicerPayEnv = process.env): SlicerStripe {
    const key = env.STRIPE_SECRET_KEY?.trim();
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(key);
    return {
        async findCustomerIdByEmail(email) {
            const result = await stripe.customers.list({ email, limit: 1 });
            return result.data[0]?.id ?? null;
        },
        async createCustomer(input) {
            const customer = await stripe.customers.create({
                email: input.email,
                metadata: input.metadata,
            });
            return customer.id;
        },
        async createPaymentSession(input) {
            const session = await stripe.checkout.sessions.create({
                mode: "payment",
                customer: input.customerId,
                line_items: [
                    {
                        quantity: input.fileCount,
                        price_data: {
                            currency: "usd",
                            unit_amount: input.unitAmountCents,
                            product_data: {
                                name: "OrthoCAD slicer G-code",
                                description:
                                    input.fileCount === 1
                                        ? "1 sliced file"
                                        : `${input.fileCount} sliced files`,
                            },
                        },
                    },
                ],
                metadata: input.metadata,
                payment_intent_data: { metadata: input.metadata },
                success_url: input.successUrl,
                cancel_url: input.cancelUrl,
            });
            return { id: session.id, url: session.url };
        },
        async retrievePaymentSession(sessionId) {
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            const customer = session.customer;
            const customerId = typeof customer === "string" ? customer : (customer?.id ?? null);
            return {
                payment_status: session.payment_status,
                mode: session.mode,
                amount_total: session.amount_total,
                metadata: session.metadata,
                customerId,
            };
        },
    };
}

function checkoutMetadata(input: {
    userId: string;
    hashes: string[];
    unitAmountCents: number;
}): Record<string, string> {
    return {
        payment_type: "slicer_gcode",
        orthocad_user_id: input.userId,
        file_count: String(input.hashes.length),
        unit_amount_cents: String(input.unitAmountCents),
        seal_hashes: input.hashes.join(","),
    };
}

export async function createSlicerCheckout(input: {
    stripe: SlicerStripe | null;
    user: { id: string; email: string };
    seals: string[];
    successUrl: string;
    cancelUrl: string;
    env?: SlicerPayEnv;
    now?: number;
}): Promise<
    | { ok: true; mock: true; sessionId: string; unitAmountCents: number; fileCount: number }
    | { ok: true; mock: false; sessionId: string; url: string; unitAmountCents: number; fileCount: number }
    | { ok: false; error: string }
> {
    const env = input.env ?? process.env;
    if (!Array.isArray(input.seals) || input.seals.length < 1 || input.seals.length > MAX_FILES) {
        return { ok: false, error: "Pay for one file or an L/R pair." };
    }
    let unitAmountCents: number;
    try {
        unitAmountCents = slicerUnitAmountCents(env);
        for (const sealed of input.seals) openSliceSeal(sealed, env);
    } catch (err) {
        return { ok: false, error: publicPayError(err, env.STRIPE_SECRET_KEY) };
    }
    const hashes = input.seals.map(sealHash);
    const fileCount = hashes.length;

    if (!input.stripe || !stripeConfigured(env)) {
        return {
            ok: true,
            mock: true,
            sessionId: issueMockSession({
                userId: input.user.id,
                hashes,
                amountCents: unitAmountCents * fileCount,
                now: input.now ?? Date.now(),
            }),
            unitAmountCents,
            fileCount,
        };
    }

    try {
        const customerId = await ensureStripeCustomerByEmail(input.stripe, input.user);
        const metadata = checkoutMetadata({ userId: input.user.id, hashes, unitAmountCents });
        const session = await input.stripe.createPaymentSession({
            customerId,
            unitAmountCents,
            fileCount,
            metadata,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
        });
        if (!session.url) return { ok: false, error: "Stripe Checkout did not return a URL" };
        return { ok: true, mock: false, sessionId: session.id, url: session.url, unitAmountCents, fileCount };
    } catch (err) {
        return { ok: false, error: publicPayError(err, env.STRIPE_SECRET_KEY) };
    }
}

export async function unlockSlicerDownload(input: {
    stripe: SlicerStripe | null;
    user: { id: string };
    sealed: string;
    sessionId: string;
    env?: SlicerPayEnv;
    now?: number;
}): Promise<{ ok: true; files: SealedSliceFile[] } | { ok: false; error: string }> {
    const env = input.env ?? process.env;
    const sessionId = input.sessionId.trim();
    if (!sessionId) return { ok: false, error: "Payment is required before download." };

    let files: SealedSliceFile[];
    try {
        files = openSliceSeal(input.sealed, env);
    } catch {
        return { ok: false, error: "This slice cannot be downloaded." };
    }
    const hash = sealHash(input.sealed);

    if (!stripeConfigured(env) || !input.stripe) {
        const mock = readMockSession(sessionId, input.now ?? Date.now());
        if (!mock || mock.uid !== input.user.id || !mock.hashes.includes(hash)) {
            return { ok: false, error: "Payment is required before download." };
        }
        return { ok: true, files };
    }

    if (sessionId.startsWith("mock_")) {
        return { ok: false, error: "Payment is required before download." };
    }

    let session: SlicerPaidSession;
    try {
        session = await input.stripe.retrievePaymentSession(sessionId);
    } catch (err) {
        return { ok: false, error: publicPayError(err, env.STRIPE_SECRET_KEY) };
    }
    const metadata = session.metadata ?? {};
    const fileCount = Number(metadata.file_count);
    const unit = Number(metadata.unit_amount_cents);
    const hashes = (metadata.seal_hashes ?? "").split(",").filter(Boolean);
    const expectedAmount = unit * fileCount;
    const paid =
        session.mode === "payment" &&
        session.payment_status === "paid" &&
        metadata.payment_type === "slicer_gcode" &&
        metadata.orthocad_user_id === input.user.id &&
        Number.isInteger(fileCount) &&
        fileCount >= 1 &&
        Number.isInteger(unit) &&
        unit >= 50 &&
        session.amount_total === expectedAmount &&
        hashes.includes(hash);
    if (!paid) return { ok: false, error: "Payment is required before download." };
    return { ok: true, files };
}
