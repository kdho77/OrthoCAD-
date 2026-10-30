// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/** Gateway / platform 413 bodies are plain text, not tRPC JSON. */
export const PAYLOAD_TOO_LARGE_MESSAGE =
    "The insole file is too large to send through the API. Your tokens were not charged.";

export const SERVER_ERROR_PLAIN_PREFIX = "A server error has occurred";

/** True when the body is tRPC / JSON (not Vercel/HTML plaintext). */
export function looksLikeJsonRpcBody(bodyText: string, contentType?: string | null): boolean {
    if (contentType && /json/i.test(contentType)) return true;
    const trimmed = bodyText.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function mapTrpcHttpFailure(status: number, bodyText: string): string {
    if (status === 413 || /request entity too large/i.test(bodyText)) {
        return PAYLOAD_TOO_LARGE_MESSAGE;
    }
    const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 400);
    if (snippet.toLowerCase().startsWith(SERVER_ERROR_PLAIN_PREFIX.toLowerCase())) {
        return `Server error (${status}): ${snippet}`;
    }
    return snippet || `Request failed (${status})`;
}

/**
 * Map tRPC / fetch failures to a user-facing string. Do not treat every
 * "not valid JSON" as a 413 — Vercel plaintext 500s start with "A server e".
 */
export function mapClientRpcError(message: string, fallback: string): string {
    if (/request entity too large/i.test(message) || message.includes(PAYLOAD_TOO_LARGE_MESSAGE)) {
        return PAYLOAD_TOO_LARGE_MESSAGE;
    }
    if (/unexpected token ['"]R['"]/i.test(message) && /not valid JSON/i.test(message)) {
        return PAYLOAD_TOO_LARGE_MESSAGE;
    }
    if (/unexpected token ['"]A['"]/i.test(message) || /A server e/i.test(message)) {
        return `Server error: ${message.replace(/\s+/g, " ").trim()}`;
    }
    return message.trim() || fallback;
}

/** Prefer the real HTTP/tRPC text over a JSON.parse wrapper. */
export function surfaceTrpcError(error: unknown, fallback = "Request failed"): string {
    if (error instanceof Error) return mapClientRpcError(error.message, fallback);
    return mapClientRpcError(String(error), fallback);
}
