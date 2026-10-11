// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * CORS origin matching for the standalone tRPC server (Render / AppSail).
 *
 * `CORS_ORIGIN` may be a single origin, `*`, or a comma-separated allow-list so
 * the Catalyst Slate host (`*.onslate.com`) and the AppSail API host can both
 * be listed without changing the Vercel default (`*` when unset).
 */
export function parseCorsOrigins(configured: string | undefined): string[] {
    const raw = (configured ?? "*")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    return raw.length > 0 ? raw : ["*"];
}

export function resolveAllowOrigin(
    requestOrigin: string | undefined,
    configured: string | undefined,
): string {
    const allowed = parseCorsOrigins(configured);
    if (allowed.includes("*")) {
        return requestOrigin && requestOrigin.length > 0 ? requestOrigin : "*";
    }
    if (requestOrigin && allowed.includes(requestOrigin)) {
        return requestOrigin;
    }
    return allowed[0] ?? "*";
}
