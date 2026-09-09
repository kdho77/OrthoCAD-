// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Gateway / platform 413 bodies are plain text, not tRPC JSON. */
export const PAYLOAD_TOO_LARGE_MESSAGE =
    "The insole file is too large to send through the API. Your tokens were not charged.";

export function mapTrpcHttpFailure(status: number, bodyText: string): string {
    if (status === 413 || /request entity too large/i.test(bodyText)) {
        return PAYLOAD_TOO_LARGE_MESSAGE;
    }
    const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 200);
    return snippet || `Request failed (${status})`;
}

/** Map tRPC/JSON parse failures to a stable user-facing export error. */
export function mapClientRpcError(message: string, fallback: string): string {
    if (
        /not valid JSON/i.test(message) ||
        /request entity too large/i.test(message) ||
        /unexpected token ['"]R['"]/i.test(message) ||
        message.includes(PAYLOAD_TOO_LARGE_MESSAGE)
    ) {
        return PAYLOAD_TOO_LARGE_MESSAGE;
    }
    return message.trim() || fallback;
}
