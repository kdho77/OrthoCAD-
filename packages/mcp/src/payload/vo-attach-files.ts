/**
 * Dogfood handoff for the live VertexOrders `attach_files` tool.
 * OrthoCAD does not call VertexOrders and does not write an order status.
 *
 * The public VO arguments are orderId / external_order_id, optional source,
 * optional design_id, optional tenant_id, and files. design_id and tenant_id
 * trigger clinic or link checks and are omitted here. A storage key is CAD
 * provenance, not a file body. There is no public idempotency argument.
 */

import { createHash } from "node:crypto";

import { VO_ATTACH_TEXT_MAX, voAttachArgumentError } from "./vo-attach-contract.js";

export const FORBIDDEN_ORDER_STATUSES = [
    "Production",
    "In Production",
    "Ready to Ship",
    "Shipped",
    "File Ready",
] as const;

/** Held orders are refused by prefix. Keep aligned with vertex/shared/dogfood-holds.ts. */
export const DOGFOOD_HELD_ID_PREFIXES = [
    "ae30903d-d205-426b-a384-152810510248",
    "886ffef7",
    "11e0ec9b",
    "c4092f6e",
] as const;

/** Retrieved reference: "Export file is over the 100 MB limit". */
const MAX_ATTACH_BYTES = 100 * 1024 * 1024;

const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

export interface VoAttachFileInput {
    side: "left" | "right";
    /** CAD object key. Recorded in provenance and never placed on the VO file. */
    storage_key?: string;
    filename?: string;
    content_base64?: string;
    download_url?: string;
    expires_at?: string;
}

export interface VoAttachFilesInput {
    order_id: string;
    /** Kept on the CAD result only. Sending it makes VO check the design link. */
    design_id?: string;
    files: VoAttachFileInput[];
    now?: number;
}

export interface VoAttachFilesArguments {
    orderId: string;
    external_order_id: string;
    source: "vo2";
    files: Array<{
        side: "left" | "right";
        format: "gcode" | "stl";
        filename: string;
        content_type: "text/plain" | "model/stl";
        content_base64?: string;
        download_url?: string;
        expires_at?: string;
    }>;
}

export interface VoAttachPreparation {
    /** Pass this object alone to VertexOrders attach_files. */
    vo_attach_files: VoAttachFilesArguments;
    cad_provenance: {
        design_id: string | null;
        vo_duplicate_suppression: "unsupported";
        cad_replay_sha256: string;
        files: Array<{
            side: "left" | "right";
            storage_key: string | null;
            sha256: string;
            byte_length: number | null;
        }>;
    };
    /** This tool does not write a VO order status. File Ready stays a VO decision. */
    order_status_written: false;
}

/**
 * Public attach_files cannot dedupe. uploadId is server-side and not an argument.
 * OrthoCAD must not send upload_id until VO accepts it, or the call is rejected.
 */
export const VO_ATTACH_RETRY_PACKET = {
    owner: "VertexOrders2-0",
    file: "lib/mcp/attach-files.ts",
    doNotEditFromOrthocad: true,
    publicSchemaHasIdempotencyKey: false,
    currentBehavior:
        "deps.uploadId defaults to crypto.randomUUID and is not a public argument. storagePath uses that id as eventId. A second attach_files call stores a new object. A batch that fails after the first save leaves that file stored, and a retry with a new id does not treat it as alreadyStored.",
    proposedPublicField: {
        name: "upload_id",
        type: "string",
        format: "uuid",
        mapsTo: "deps.uploadId",
    },
    downloadUrlLimit: {
        current: "readShortText TEXT_MAX 200 includes download_url",
        effect: "A signed URL longer than 200 characters is rejected before fetch",
        proposed:
            "Do not apply TEXT_MAX to download_url. Keep a single https fetch and the expires_at check.",
    },
    acceptance: [
        "Two attach_files calls with the same upload_id and the same files return alreadyStored true and do not fetch those URLs again.",
        "A different upload_id stores a second object.",
        "A batch that fails on file 2 leaves file 1 stored. Retry with the same upload_id skips file 1 and retries file 2.",
        "An https download_url longer than 200 characters is accepted when expires_at is absent or in the future.",
        "The result keeps orderStatusUnchanged true and writes no order status.",
        "tenant_id and design_id stay optional and are still not stored.",
    ],
} as const;

function assertNotHeld(value: string): void {
    const id = value.trim().toLowerCase();
    for (const prefix of DOGFOOD_HELD_ID_PREFIXES) {
        if (id === prefix || id.startsWith(prefix)) {
            throw new Error("This order is on hold and is not available to the dogfood path.");
        }
    }
}

function decodeBase64(value: string): Buffer {
    const compact = value.replace(/\s/g, "");
    if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
        throw new Error("content_base64 is not valid base64");
    }
    const bytes = Buffer.from(compact, "base64");
    if (bytes.byteLength === 0) throw new Error("file is empty");
    if (bytes.byteLength > MAX_ATTACH_BYTES) throw new Error("Export file is over the 100 MB limit");
    return bytes;
}

/**
 * Durable central-fab STL object key. Must match
 * `buildCadOperatorCentralFabStlKey` in vertex/server/src/auth/cad-operator.ts.
 * Temp manufacturing uploads and belt G-code keys are not this path.
 */
export function isCentralFabStlStorageKey(key: string | undefined): boolean {
    if (!key) return false;
    const trimmed = key.trim();
    if (!trimmed.startsWith("stl/cad-operator/") || !trimmed.endsWith(".stl")) return false;
    if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("//")) return false;
    return true;
}

function centralFabStlFilename(side: "left" | "right", requested: string | undefined): string {
    const raw = requested?.trim() ?? "";
    if (!raw) return `${side}.stl`;
    const base = raw.split(/[/\\]/).pop()?.trim() ?? "";
    const lowered = base.toLowerCase();
    if (
        lowered.length <= 180 &&
        !lowered.includes("..") &&
        FILENAME_RE.test(base) &&
        lowered.endsWith(".stl") &&
        lowered.startsWith(side)
    ) {
        return lowered;
    }
    throw new Error("Central-fab STL filename must start with the foot and end with .stl");
}

function gcodeFilename(side: "left" | "right", requested: string | undefined): string {
    const raw = requested?.trim() ?? "";
    const base = raw.split(/[/\\]/).pop()?.trim() ?? "";
    const lowered = base.toLowerCase();
    if (
        base &&
        lowered.length <= 180 &&
        !lowered.includes("..") &&
        FILENAME_RE.test(base) &&
        lowered.endsWith(".gcode") &&
        !lowered.includes(".stl") &&
        lowered.startsWith(side)
    ) {
        return lowered;
    }
    return `${side}.gcode`;
}

export function buildVoAttachFilesHandoff(input: VoAttachFilesInput): VoAttachPreparation {
    const orderId = input.order_id.trim();
    if (!orderId) throw new Error("orderId or external_order_id is required");
    assertNotHeld(orderId);
    if (input.design_id) assertNotHeld(input.design_id);
    if (input.files.length < 1) throw new Error("files must be an array of 1 to 10");

    const seen = new Set<string>();
    const files: VoAttachFilesArguments["files"] = [];
    const provenanceFiles: VoAttachPreparation["cad_provenance"]["files"] = [];

    for (const file of [...input.files].sort((a, b) => a.side.localeCompare(b.side))) {
        if (seen.has(file.side)) throw new Error(`duplicate ${file.side} file`);
        seen.add(file.side);
        const centralFab = isCentralFabStlStorageKey(file.storage_key);
        if (!centralFab && file.filename && /\.stl($|\?)/i.test(file.filename)) {
            throw new Error("STL files are not attached. G-code only.");
        }
        const filename = centralFab
            ? centralFabStlFilename(file.side, file.filename)
            : gcodeFilename(file.side, file.filename);
        if (!centralFab && filename.toLowerCase().endsWith(".stl")) {
            throw new Error("STL files are not attached. G-code only.");
        }
        const download = file.download_url?.trim() || "";
        const encoded = file.content_base64?.trim() || "";
        if (download && encoded) {
            throw new Error("file must include download_url or content_base64, not both");
        }
        if (!download && !encoded) {
            throw new Error(
                file.storage_key
                    ? "storage_key is not attachable bytes. file must include download_url or content_base64, not both"
                    : "file must include download_url or content_base64, not both",
            );
        }
        if (!centralFab && download && /\.stl($|\?)/i.test(download)) {
            throw new Error("STL files are not attached. G-code only.");
        }
        if (download && !download.toLowerCase().startsWith("https://")) {
            throw new Error("download_url must be an https URL");
        }
        if (download && download.length > VO_ATTACH_TEXT_MAX) {
            throw new Error(
                `download_url must be 1-${VO_ATTACH_TEXT_MAX} characters. Pass content_base64 for this G-code.`,
            );
        }
        if (download && file.expires_at) {
            const expires = Date.parse(file.expires_at);
            if (!Number.isFinite(expires)) throw new Error("expires_at must be an ISO timestamp");
            if (expires <= (input.now ?? Date.now())) throw new Error("file download_url has expired");
        }

        let byteLength: number | null = null;
        let digestSource = download;
        if (encoded) {
            const bytes = decodeBase64(encoded);
            byteLength = bytes.byteLength;
            digestSource = bytes.toString("base64");
        }
        const wire: VoAttachFilesArguments["files"][number] = {
            side: file.side,
            format: centralFab ? "stl" : "gcode",
            filename,
            content_type: centralFab ? "model/stl" : "text/plain",
        };
        if (encoded) wire.content_base64 = encoded.replace(/\s/g, "");
        if (download) {
            wire.download_url = download;
            if (file.expires_at) wire.expires_at = file.expires_at;
        }
        files.push(wire);
        provenanceFiles.push({
            side: file.side,
            storage_key: file.storage_key?.trim() || null,
            sha256: createHash("sha256").update(digestSource).digest("hex"),
            byte_length: byteLength,
        });
    }

    const voAttachFiles: VoAttachFilesArguments = {
        orderId,
        external_order_id: orderId,
        source: "vo2",
        files,
    };
    const rejected = voAttachArgumentError(voAttachFiles, input.now ?? Date.now());
    if (rejected) throw new Error(rejected);

    return {
        vo_attach_files: voAttachFiles,
        cad_provenance: {
            design_id: input.design_id ?? null,
            vo_duplicate_suppression: "unsupported",
            cad_replay_sha256: createHash("sha256").update(JSON.stringify(voAttachFiles)).digest("hex"),
            files: provenanceFiles,
        },
        order_status_written: false,
    };
}
