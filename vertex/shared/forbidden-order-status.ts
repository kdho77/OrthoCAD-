// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// OrthoCAD handoffs never emit an order status. File Ready stays outside this repo.

export const FORBIDDEN_ORDER_STATUSES = [
    "Production",
    "In Production",
    "Ready to Ship",
    "Shipped",
    "File Ready",
] as const;

export type ForbiddenOrderStatus = (typeof FORBIDDEN_ORDER_STATUSES)[number];

const FORBIDDEN = new Set(FORBIDDEN_ORDER_STATUSES.map((status) => status.toLowerCase()));

/** Exact status text only. Surrounding sentences are not treated as a status. */
export function forbiddenOrderStatus(value: unknown): ForbiddenOrderStatus | null {
    if (typeof value === "string") {
        const found = FORBIDDEN_ORDER_STATUSES.find((status) => status.toLowerCase() === value.trim().toLowerCase());
        return found ?? null;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = forbiddenOrderStatus(entry);
            if (found) return found;
        }
        return null;
    }
    if (!value || typeof value !== "object") return null;
    for (const child of Object.values(value)) {
        const found = forbiddenOrderStatus(child);
        if (found) return found;
    }
    return null;
}

export function assertNoForbiddenOrderStatus(value: unknown): void {
    const found = forbiddenOrderStatus(value);
    if (found) {
        throw new Error(`Handoff refused: order status "${found}" is not emitted by OrthoCAD.`);
    }
    if (value && typeof value === "object") {
        const keys = Object.keys(value as object);
        if (keys.some((key) => key.toLowerCase() === "status" || key.toLowerCase() === "order_status")) {
            throw new Error("Handoff refused: order status is not part of this payload.");
        }
    }
}

export { FORBIDDEN as FORBIDDEN_ORDER_STATUS_KEYS };
