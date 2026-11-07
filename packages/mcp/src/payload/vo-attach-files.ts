/**
 * Handoff for VertexOrders `attach_files` (lib/mcp/attach-files.ts).
 * OrthoCAD does not call VertexOrders. Re-running with the same order, design,
 * and storage keys returns the same idempotency key.
 *
 * The VO source file was not readable from this workspace. Field names follow
 * the contract named for this path: order id, left/right side, durable storage
 * key, idempotent re-run. Confirm them against that file before a live attach.
 */

import { createHash } from "node:crypto";

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

export interface VoAttachFile {
    side: "left" | "right";
    storage_key: string;
    filename: string;
    content_type: "text/plain";
    format: "gcode";
}

export interface VoAttachFilesHandoff {
    order_id: string;
    design_id: string;
    files: VoAttachFile[];
    idempotency_key: string;
}

export interface VoAttachFilesInput {
    order_id: string;
    design_id: string;
    files: Array<{ side: "left" | "right"; storage_key: string; filename?: string }>;
}

function assertNotHeld(value: string): void {
    const id = value.trim().toLowerCase();
    for (const prefix of DOGFOOD_HELD_ID_PREFIXES) {
        if (id === prefix || id.startsWith(prefix)) {
            throw new Error("This order is on hold and is not available to the dogfood path.");
        }
    }
}

function assertNoStatus(value: unknown): void {
    if (typeof value === "string") {
        const found = FORBIDDEN_ORDER_STATUSES.find(
            (status) => status.toLowerCase() === value.trim().toLowerCase(),
        );
        if (found) throw new Error(`Handoff refused: order status "${found}" is not emitted by OrthoCAD.`);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) assertNoStatus(entry);
        return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
        if (key.toLowerCase() === "status" || key.toLowerCase() === "order_status") {
            throw new Error("Handoff refused: order status is not part of this payload.");
        }
        assertNoStatus(child);
    }
}

export function buildVoAttachFilesHandoff(input: VoAttachFilesInput): VoAttachFilesHandoff {
    const orderId = input.order_id.trim();
    const designId = input.design_id.trim();
    if (!orderId) throw new Error("order_id is required");
    if (!designId) throw new Error("design_id is required");
    assertNotHeld(orderId);
    assertNotHeld(designId);
    if (input.files.length < 1) throw new Error("at least one G-code file is required");

    const seen = new Set<string>();
    const files: VoAttachFile[] = input.files
        .map((file) => {
            const storageKey = file.storage_key.trim();
            if (!storageKey || storageKey.includes("..")) throw new Error("storage_key is required");
            if (/\.stl($|\?)/i.test(storageKey)) {
                throw new Error("STL files are not attached. G-code storage keys only.");
            }
            if (seen.has(file.side)) throw new Error(`duplicate ${file.side} file`);
            seen.add(file.side);
            const filename = (file.filename?.trim() || `${file.side}.gcode`).replace(/[^a-zA-Z0-9_.-]/g, "_");
            return {
                side: file.side,
                storage_key: storageKey,
                filename,
                content_type: "text/plain" as const,
                format: "gcode" as const,
            };
        })
        .sort((a, b) => a.side.localeCompare(b.side));

    const idempotencyKey = createHash("sha256")
        .update(
            JSON.stringify({
                order_id: orderId,
                design_id: designId,
                files: files.map((file) => ({ side: file.side, storage_key: file.storage_key })),
            }),
        )
        .digest("hex");

    const payload: VoAttachFilesHandoff = {
        order_id: orderId,
        design_id: designId,
        files,
        idempotency_key: idempotencyKey,
    };
    assertNoStatus(payload);
    return payload;
}
