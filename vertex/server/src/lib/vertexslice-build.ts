/**
 * VertexSlice build fingerprint for the belt G-code cache key.
 *
 * A succeeded production is reused only when it was sliced by the same slicer build. The build is
 * read from the slicer's own GET /health ("build": a content hash of its server code, profiles and
 * slicer binary), so any slicer change invalidates every cached G-code automatically.
 *
 * When the build cannot be read (old slicer, network error, malformed reply), the caller must not
 * reuse anything: it gets null and forces a fresh slice.
 */
export const UNKNOWN_SLICER_BUILD = "unknown";

const BUILD_PATTERN = /^[0-9a-f]{16,64}$/;
const SUCCESS_TTL_MS = 60_000;
const FAILURE_TTL_MS = 10_000;
/**
 * Bound for GET /health. AbortSignal.timeout is not used: on this runtime its
 * timer is unref'd and a hung health read held generate_gcode until the MCP
 * client reported -32001, after the production row had already been inserted.
 */
export const HEALTH_TIMEOUT_MS = 5_000;

function healthDeadline(timeoutMs: number): {
    signal: AbortSignal;
    elapsed: Promise<void>;
    cancel: () => void;
} {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const elapsed = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
            controller.abort();
            resolve();
        }, timeoutMs);
        timer.ref?.();
    });
    return {
        signal: controller.signal,
        elapsed,
        cancel: () => {
            if (timer) clearTimeout(timer);
        },
    };
}

let cached: { value: string | null; expiresAtMs: number; baseUrl: string } | null = null;

export function parseVertexSliceBuild(body: unknown): string | null {
    if (!body || typeof body !== "object") return null;
    const build = (body as { build?: unknown }).build;
    if (typeof build !== "string") return null;
    const value = build.trim().toLowerCase();
    return BUILD_PATTERN.test(value) ? value : null;
}

export function resetVertexSliceBuildCache(): void {
    cached = null;
}

export async function getVertexSliceBuild(options?: {
    fetchImpl?: typeof fetch;
    nowMs?: number;
    baseUrl?: string;
    timeoutMs?: number;
}): Promise<string | null> {
    const baseUrl = (options?.baseUrl ?? process.env.VERTEXSLICE_SLICER_URL ?? "").trim().replace(/\/+$/, "");
    if (!baseUrl) return null;
    const nowMs = options?.nowMs ?? Date.now();
    if (cached && cached.baseUrl === baseUrl && cached.expiresAtMs > nowMs) return cached.value;
    const fetchImpl = options?.fetchImpl ?? fetch;
    const deadline = healthDeadline(options?.timeoutMs ?? HEALTH_TIMEOUT_MS);
    let value: string | null = null;
    try {
        const pending = fetchImpl(`${baseUrl}/health`, {
            method: "GET",
            signal: deadline.signal,
        });
        void pending.catch(() => undefined);
        const response = await Promise.race([pending, deadline.elapsed.then(() => null)]);
        if (response?.ok) value = parseVertexSliceBuild(await response.json());
    } catch {
        value = null;
    } finally {
        deadline.cancel();
    }
    cached = { value, baseUrl, expiresAtMs: nowMs + (value ? SUCCESS_TTL_MS : FAILURE_TTL_MS) };
    return value;
}
