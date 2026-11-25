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
const HEALTH_TIMEOUT_MS = 5_000;

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
}): Promise<string | null> {
    const baseUrl = (options?.baseUrl ?? process.env.VERTEXSLICE_SLICER_URL ?? "").trim().replace(/\/+$/, "");
    if (!baseUrl) return null;
    const nowMs = options?.nowMs ?? Date.now();
    if (cached && cached.baseUrl === baseUrl && cached.expiresAtMs > nowMs) return cached.value;
    const fetchImpl = options?.fetchImpl ?? fetch;
    let value: string | null = null;
    try {
        const response = await fetchImpl(`${baseUrl}/health`, {
            method: "GET",
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        if (response.ok) value = parseVertexSliceBuild(await response.json());
    } catch {
        value = null;
    }
    cached = { value, baseUrl, expiresAtMs: nowMs + (value ? SUCCESS_TTL_MS : FAILURE_TTL_MS) };
    return value;
}
