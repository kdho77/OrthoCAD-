// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Structured console logging for default stock base resolution (grep: STOCK_DEBUG). */
export function stockDebug(message: string, data?: Record<string, unknown>): void {
    if (data !== undefined) {
        console.log(`[STOCK_DEBUG] ${message}`, data);
    } else {
        console.log(`[STOCK_DEBUG] ${message}`);
    }
}
