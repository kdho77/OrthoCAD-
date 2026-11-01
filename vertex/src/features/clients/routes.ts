// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductionTab = "queue" | "printers" | "history";

export type ClinicalRoute =
    | { kind: "home" }
    | { kind: "production"; tab: ProductionTab }
    | { kind: "list" }
    | { kind: "file"; clientId: string }
    | { kind: "design"; clientId: string; designId: string };

/** Paths carry opaque ids only. A non-uuid segment never becomes a route param. */
export function parseClinicalPath(pathname: string): ClinicalRoute {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 0) return { kind: "home" };
    if (parts[0] === "orders" || parts[0] === "production") {
        const tab = parts[1] === "printers" || parts[1] === "history" ? parts[1] : "queue";
        return { kind: "production", tab };
    }
    if (parts[0] !== "clients") return { kind: "home" };
    if (parts.length === 1) return { kind: "list" };
    if (!parts[1] || !UUID.test(parts[1])) return { kind: "list" };
    if (parts.length === 2) return { kind: "file", clientId: parts[1] };
    if (parts[2] === "designs" && parts[3] && UUID.test(parts[3])) {
        return { kind: "design", clientId: parts[1], designId: parts[3] };
    }
    return { kind: "file", clientId: parts[1] };
}

export function clientFilePath(clientId: string): string {
    return `/clients/${clientId}`;
}

export function designPath(clientId: string, designId: string): string {
    return `/clients/${clientId}/designs/${designId}`;
}
