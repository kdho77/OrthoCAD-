/**
 * Argument checks mirrored from the retrieved VertexOrders main reference
 * `lib/mcp/attach-files.ts` (ATTACH_FILES_ARGUMENT_KEYS, FILE_KEYS, parseFile,
 * envelopeRequiresSource, TEXT_MAX) plus the observed live tool schema.
 *
 * This is not a deployed-server proof and it does not call VertexOrders.
 * `uploadId` is intentionally absent: the reference keeps it off the public arguments.
 */

export const VO_ATTACH_ARGUMENT_KEYS = [
    "orderId",
    "external_order_id",
    "source",
    "design_id",
    "tenant_id",
    "files",
] as const;

export const VO_ATTACH_FILE_KEYS = [
    "side",
    "machine",
    "format",
    "material",
    "download_url",
    "expires_at",
    "content_type",
    "filename",
    "content_base64",
] as const;

/** `readShortText` limit in the retrieved reference. It applies to download_url. */
export const VO_ATTACH_TEXT_MAX = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function readShortText(value: unknown, label: string): string | null | { error: string } {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return { error: `${label} must be a string` };
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > VO_ATTACH_TEXT_MAX) {
        return { error: `${label} must be 1-${VO_ATTACH_TEXT_MAX} characters` };
    }
    return trimmed;
}

function orderUuid(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * Returns null when the object is an argument object `attach_files` accepts.
 * Does not fetch URLs or write an order.
 */
export function voAttachArgumentError(args: unknown, now = Date.now()): string | null {
    const record = asRecord(args);
    if (!record) return "attach_files arguments must be an object";
    for (const key of Object.keys(record)) {
        if (!(VO_ATTACH_ARGUMENT_KEYS as readonly string[]).includes(key)) {
            return "Unexpected attach_files field";
        }
    }

    if (record.orderId !== undefined && !orderUuid(record.orderId)) return "orderId must be a UUID";
    if (record.external_order_id !== undefined && !orderUuid(record.external_order_id)) {
        return "external_order_id must be a UUID";
    }
    const orderFromArg = orderUuid(record.orderId);
    const external = orderUuid(record.external_order_id);
    if (orderFromArg && external && orderFromArg !== external) {
        return "orderId and external_order_id must be the same order";
    }
    if (!orderFromArg && !external) return "orderId or external_order_id is required";

    if (!Array.isArray(record.files) || record.files.length < 1 || record.files.length > 10) {
        return "files must be an array of 1 to 10";
    }

    let anyDownload = false;
    for (const [index, raw] of record.files.entries()) {
        const file = asRecord(raw);
        if (!file) return `files[${index}] must be an object`;
        for (const key of Object.keys(file)) {
            if (!(VO_ATTACH_FILE_KEYS as readonly string[]).includes(key)) return "Unexpected file field";
        }
        const sideRaw = readShortText(file.side, "side");
        if (sideRaw && typeof sideRaw !== "string") return sideRaw.error;
        const side = (sideRaw ?? "").toLowerCase();
        if (side && side !== "left" && side !== "right" && side !== "combined" && side !== "both") {
            return "file side must be left, right, combined, or both";
        }
        const downloadUrl = readShortText(file.download_url, "download_url");
        if (downloadUrl && typeof downloadUrl !== "string") return downloadUrl.error;
        const contentBase64 =
            file.content_base64 === undefined || file.content_base64 === null ? null : file.content_base64;
        if (contentBase64 !== null && typeof contentBase64 !== "string") return "content_base64 must be a string";
        if (Boolean(downloadUrl) === Boolean(contentBase64)) {
            return "file must include download_url or content_base64, not both";
        }
        if (downloadUrl) anyDownload = true;
        if (file.expires_at !== undefined && file.expires_at !== null) {
            if (typeof file.expires_at !== "string" || !file.expires_at.trim()) {
                return "expires_at must be an ISO timestamp";
            }
            const expires = Date.parse(file.expires_at);
            if (!Number.isFinite(expires)) return "expires_at must be an ISO timestamp";
            if (expires <= now) return "file download_url has expired";
        }
        if (file.content_type !== undefined && file.content_type !== null && file.content_type !== "") {
            if (typeof file.content_type !== "string") return "content_type must be a string";
            const trimmed = file.content_type.trim().toLowerCase();
            if (!/^[\w.+-]+\/[\w.+-]+$/.test(trimmed) || trimmed.length > 120) {
                return "content_type is not allowed";
            }
        }
    }

    const sourceRequired =
        record.design_id !== undefined ||
        record.tenant_id !== undefined ||
        record.external_order_id !== undefined ||
        anyDownload ||
        record.source !== undefined;
    if (sourceRequired && record.source !== "vo2") return "source must be vo2";
    return null;
}
