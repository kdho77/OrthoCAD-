// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** In-memory sliding-window rate limiter for tRPC mutations (per user + route). */
export interface RateLimitConfig {
    /** Max requests allowed within the window. */
    limit: number;
    /** Window size in milliseconds. */
    windowMs: number;
}

interface Bucket {
    timestamps: number[];
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, config: RateLimitConfig): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = Date.now();
    const cutoff = now - config.windowMs;
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = { timestamps: [] };
        buckets.set(key, bucket);
    }
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length >= config.limit) {
        const oldest = bucket.timestamps[0] ?? now;
        return { ok: false, retryAfterMs: Math.max(0, oldest + config.windowMs - now) };
    }
    bucket.timestamps.push(now);
    return { ok: true };
}

export function rateLimitKey(userId: string, route: string): string {
    return `${userId}:${route}`;
}

/** Default limits for production-sensitive routes. */
export const RATE_LIMITS = {
    export: { limit: 30, windowMs: 60_000 },
    ai: { limit: 10, windowMs: 60_000 },
    librarySave: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitConfig>;
