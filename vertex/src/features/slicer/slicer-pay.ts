// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** USD charged per uploaded file (one file or each side of an L/R pair). */
export const SLICER_PRICE_USD_PER_FILE = 8;

export type SlicerPaymentStatus = "unpaid" | "paying" | "paid" | "failed";

export interface SlicerPaySuccess {
    ok: true;
    mock: boolean;
    paymentId: string;
}

export interface SlicerPayFailure {
    ok: false;
    mock: boolean;
    error: string;
}

export type SlicerPayResult = SlicerPaySuccess | SlicerPayFailure;

/**
 * Pay is mocked until Stripe is wired. Mock stays on unless
 * `VITE_SLICER_PAY_MOCK=0` *and* a publishable Stripe key is present.
 */
function viteEnv(name: string): string {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    return String(env?.[name] ?? "").trim();
}

export function isSlicerPayMock(): boolean {
    const flag = viteEnv("VITE_SLICER_PAY_MOCK");
    if (flag === "0" || flag.toLowerCase() === "false") {
        return !viteEnv("VITE_STRIPE_PUBLISHABLE_KEY");
    }
    if (flag === "1" || flag.toLowerCase() === "true") return true;
    return !viteEnv("VITE_STRIPE_PUBLISHABLE_KEY");
}

export function slicerPriceUsd(fileCount: number): number {
    return SLICER_PRICE_USD_PER_FILE * Math.max(1, fileCount);
}

export function formatSlicerPriceUsd(fileCount: number): string {
    return `$${slicerPriceUsd(fileCount).toFixed(2)}`;
}

export function canDownloadSlicerGcode(paymentStatus: SlicerPaymentStatus): boolean {
    return paymentStatus === "paid";
}

/** Mock checkout. Live Stripe is not wired; this is the pay step until it is. */
export async function chargeSlicerExport(input: {
    fileCount: number;
    signal?: AbortSignal;
}): Promise<SlicerPayResult> {
    const mock = isSlicerPayMock();
    if (input.signal?.aborted) {
        return { ok: false, mock, error: "Payment cancelled." };
    }
    if (input.fileCount < 1) {
        return { ok: false, mock, error: "Nothing to pay for." };
    }
    if (!mock) {
        return {
            ok: false,
            mock: false,
            error: "Card checkout is not wired yet. Use mock pay on this preview.",
        };
    }
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 450);
            const onAbort = () => {
                clearTimeout(timer);
                reject(new DOMException("Payment cancelled.", "AbortError"));
            };
            if (input.signal?.aborted) {
                onAbort();
                return;
            }
            input.signal?.addEventListener("abort", onAbort, { once: true });
        });
    } catch {
        return { ok: false, mock, error: "Payment cancelled." };
    }
    if (input.signal?.aborted) {
        return { ok: false, mock, error: "Payment cancelled." };
    }
    return { ok: true, mock: true, paymentId: `mock_${crypto.randomUUID()}` };
}
