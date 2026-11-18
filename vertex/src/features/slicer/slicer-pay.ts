// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export type SlicerPaymentStatus = "unpaid" | "paying" | "paid" | "failed";

/** Format a server-provided cent amount. The price itself comes from the server. */
export function formatUsdFromCents(cents: number): string {
    const safe = Number.isFinite(cents) ? cents : 0;
    return `$${(safe / 100).toFixed(2)}`;
}

export function formatSlicerPriceLabel(unitAmountCents: number, fileCount: number): string {
    return formatUsdFromCents(unitAmountCents * Math.max(1, fileCount));
}

export function canDownloadSlicerGcode(paymentStatus: SlicerPaymentStatus): boolean {
    return paymentStatus === "paid";
}
