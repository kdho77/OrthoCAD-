// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Text from an upstream JSON or plain-text error body.
 * Reads both `message` (Railway, many proxies) and `detail` (FastAPI).
 */
export function upstreamErrorText(body: unknown, statusText = ""): string {
    const parts: string[] = [];
    const push = (value: string) => {
        const trimmed = value.trim();
        if (trimmed && !parts.includes(trimmed)) parts.push(trimmed);
    };

    if (typeof body === "string") {
        push(body);
    } else if (body && typeof body === "object") {
        const rec = body as Record<string, unknown>;
        if (typeof rec.message === "string") push(rec.message);
        if (typeof rec.detail === "string") {
            push(rec.detail);
        } else if (Array.isArray(rec.detail)) {
            const msgs = rec.detail
                .map((item) => {
                    if (typeof item === "string") return item.trim();
                    if (!item || typeof item !== "object" || !("msg" in item)) return "";
                    const msg = (item as { msg: unknown }).msg;
                    if (typeof msg !== "string" || !msg.trim()) return "";
                    const loc = (item as { loc?: unknown }).loc;
                    const locText = Array.isArray(loc)
                        ? loc.filter((part): part is string => typeof part === "string").join(".")
                        : "";
                    return locText ? `${locText}: ${msg.trim()}` : msg.trim();
                })
                .filter(Boolean);
            if (msgs.length) push(msgs.join("; "));
        }
        if (typeof rec.error === "string") push(rec.error);
    }

    if (parts.length) return parts.join(": ");
    return statusText.trim() || "Unknown error";
}

/** Read a failed response once and surface `message` and `detail`. */
export async function readUpstreamErrorText(response: Response): Promise<string> {
    const raw = await response.text().catch(() => "");
    if (!raw.trim()) return upstreamErrorText(null, response.statusText);
    try {
        return upstreamErrorText(JSON.parse(raw) as unknown, response.statusText);
    } catch {
        return raw.trim();
    }
}
