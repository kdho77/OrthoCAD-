// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// REST surface for POST /api/integrations/v1/*. The API key stays on this hop.
// Responses never include the key, and errors are logged only after redaction.

import { z } from "zod";

import { redactSecrets } from "../../auth/integration-keys.js";
import type { IntegrationDeps, SessionUser } from "./service.js";
import { createIntegrationService, IntegrationError } from "./service.js";
import type {
    DesignSides,
    DesignType,
    IntegrationSource,
    ScanFormat,
    ScanSide,
    ShoeSize,
    ShoeSystem,
    ShoeWidth,
} from "./store.js";

const sourceSchema = z.enum(["vo2", "orthocloud"]);
const shoeSchema = z.object({
    system: z.enum(["US_M", "US_W", "EU"]),
    size: z.number().finite().positive(),
});
const widthSchema = z.enum(["narrow", "medium", "wide"]);

const upsertSchema = z.object({
    source: sourceSchema,
    external_client_id: z.string().trim().min(1).max(200),
    tenant_id: z.string().uuid(),
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    dob: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    shoe_size: shoeSchema,
    shoe_size_left: z.number().finite().positive().optional(),
    shoe_size_right: z.number().finite().positive().optional(),
    width: widthSchema.optional(),
});

const scanDeclareSchema = z.object({
    side: z.enum(["left", "right", "combined"]).optional(),
    format: z.enum(["stl", "obj", "ply"]).optional(),
});

const designSchema = z.object({
    source: sourceSchema,
    tenant_id: z.string().uuid(),
    client_id: z.string().uuid(),
    external_order_id: z.string().trim().min(1).max(200),
    type: z.enum(["insole", "afo"]),
    sides: z.enum(["pair", "left", "right"]),
    rx_text: z.string().max(5000).optional(),
    notes: z.string().max(5000).optional(),
    order_reference: z.string().max(120).optional(),
    ordered_by_account: z.string().max(120).optional(),
    parent_external_order_id: z.string().trim().min(1).max(200).optional(),
    shoe_size: shoeSchema.optional(),
    shoe_size_left: z.number().finite().positive().optional(),
    shoe_size_right: z.number().finite().positive().optional(),
    width: widthSchema.optional(),
    scans: z.array(scanDeclareSchema).optional(),
});

const completeSchema = z.object({
    scans: z
        .array(
            z.object({
                side: z.enum(["left", "right", "combined"]),
                file_name: z.string().trim().min(1).max(180),
                format: z.enum(["stl", "obj", "ply"]),
                size_bytes: z.number().int().positive(),
            }),
        )
        .min(1),
});

const launchSchema = z.object({
    design_id: z.string().uuid(),
    actor: z
        .object({
            kind: z.enum(["clinic", "vertex_staff"]),
            user_id: z.string().uuid().optional(),
        })
        .optional(),
});

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

function asRecord(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new IntegrationError(422, "Request body must be a JSON object");
    }
    return body as Record<string, unknown>;
}

function shoeFrom(
    raw: z.infer<typeof shoeSchema>,
    left?: number,
    right?: number,
    width?: ShoeWidth,
): ShoeSize {
    if ((left == null) !== (right == null)) {
        throw new IntegrationError(422, "shoe_size_left and shoe_size_right must both be set");
    }
    return {
        system: raw.system,
        size: raw.size,
        left: left ?? null,
        right: right ?? null,
        width: width ?? "medium",
    };
}

function parseFailure(error: z.ZodError, fallback: string): IntegrationError {
    const issue = error.issues[0];
    const path = issue?.path.join(".") ?? "";
    if (path === "shoe_size")
        return new IntegrationError(422, "shoe_size must be { system: US_M|US_W|EU, size }");
    if (path === "sides") return new IntegrationError(422, "sides is required");
    if (path.endsWith("side")) return new IntegrationError(422, "scan side is required");
    return new IntegrationError(422, issue?.message ? `${path || "body"}: ${issue.message}` : fallback);
}

export function createIntegrationHandler(deps: IntegrationDeps) {
    const service = createIntegrationService(deps);

    return async function handleIntegration(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, "") || "/";
        try {
            const authorization = request.headers.get("authorization") ?? undefined;
            if (request.method === "GET") {
                const one = /^\/api\/integrations\/v1\/designs\/([^/]+)$/.exec(path);
                if (one) {
                    const designId = decodeURIComponent(one[1] ?? "");
                    if (!z.string().uuid().safeParse(designId).success) {
                        throw new IntegrationError(422, "design id must be a uuid");
                    }
                    return json(200, await service.getDesignForCredential(authorization, designId));
                }
                if (path === "/api/integrations/v1/designs") {
                    const tenantId = url.searchParams.get("tenant_id") ?? "";
                    if (!z.string().uuid().safeParse(tenantId).success) {
                        throw new IntegrationError(422, "tenant_id must be a uuid");
                    }
                    return json(
                        200,
                        await service.listDesignsForCredential(authorization, {
                            source: url.searchParams.get("source") ?? "",
                            tenantId,
                            externalOrderId: url.searchParams.get("external_order_id") ?? "",
                        }),
                    );
                }
                return json(404, { error: "Not found" });
            }
            if (request.method !== "POST") return json(405, { error: "Method not allowed" });
            if (path === "/api/integrations/v1/clients/upsert") {
                const raw = asRecord(await readBody(request));
                if (!("shoe_size" in raw) || raw.shoe_size == null) {
                    throw new IntegrationError(422, "shoe_size is required");
                }
                const parsed = upsertSchema.safeParse(raw);
                if (!parsed.success) throw parseFailure(parsed.error, "Invalid client");
                const shoe = shoeFrom(
                    parsed.data.shoe_size,
                    parsed.data.shoe_size_left,
                    parsed.data.shoe_size_right,
                    parsed.data.width,
                );
                const result = await service.upsertClient(authorization, {
                    source: parsed.data.source,
                    tenantId: parsed.data.tenant_id,
                    externalClientId: parsed.data.external_client_id,
                    firstName: parsed.data.first_name,
                    lastName: parsed.data.last_name,
                    dob: parsed.data.dob ?? null,
                    shoe,
                });
                return json(200, result);
            }
            if (path === "/api/integrations/v1/designs") {
                const raw = asRecord(await readBody(request));
                if (!("sides" in raw) || raw.sides == null || raw.sides === "") {
                    throw new IntegrationError(422, "sides is required");
                }
                const parsed = designSchema.safeParse(raw);
                if (!parsed.success) throw parseFailure(parsed.error, "Invalid design");
                const scanSides: ScanSide[] = [];
                for (const scan of parsed.data.scans ?? []) {
                    if (!scan.side) throw new IntegrationError(422, "scan side is required");
                    scanSides.push(scan.side);
                }
                const shoe = parsed.data.shoe_size
                    ? shoeFrom(
                          parsed.data.shoe_size,
                          parsed.data.shoe_size_left,
                          parsed.data.shoe_size_right,
                          parsed.data.width,
                      )
                    : null;
                const result = await service.createDesign(authorization, {
                    source: parsed.data.source as IntegrationSource,
                    tenantId: parsed.data.tenant_id,
                    clientId: parsed.data.client_id,
                    externalOrderId: parsed.data.external_order_id,
                    type: parsed.data.type as DesignType,
                    sides: parsed.data.sides as DesignSides,
                    rxText: parsed.data.rx_text ?? null,
                    notes: parsed.data.notes ?? null,
                    orderReference: parsed.data.order_reference ?? null,
                    orderedByAccount: parsed.data.ordered_by_account ?? null,
                    parentExternalOrderId: parsed.data.parent_external_order_id ?? null,
                    shoe,
                    scanSides,
                });
                return json(200, result);
            }
            const complete = /^\/api\/integrations\/v1\/designs\/([^/]+)\/scans\/complete$/.exec(path);
            if (complete) {
                const designId = complete[1] ?? "";
                if (!z.string().uuid().safeParse(designId).success) {
                    throw new IntegrationError(422, "design id must be a uuid");
                }
                const raw = asRecord(await readBody(request));
                const scans = Array.isArray(raw.scans) ? raw.scans : null;
                if (scans) {
                    for (const scan of scans) {
                        if (
                            !scan ||
                            typeof scan !== "object" ||
                            !("side" in scan) ||
                            (scan as { side?: unknown }).side == null
                        ) {
                            throw new IntegrationError(422, "scan side is required");
                        }
                    }
                }
                const parsed = completeSchema.safeParse(raw);
                if (!parsed.success) throw parseFailure(parsed.error, "Invalid scan completion");
                const result = await service.completeScans(
                    authorization,
                    designId,
                    parsed.data.scans.map((scan) => ({
                        side: scan.side as ScanSide,
                        fileName: scan.file_name,
                        format: scan.format as ScanFormat,
                        sizeBytes: scan.size_bytes,
                    })),
                );
                return json(200, result);
            }
            if (path === "/api/integrations/v1/launch") {
                const parsed = launchSchema.safeParse(asRecord(await readBody(request)));
                if (!parsed.success) throw parseFailure(parsed.error, "Invalid launch");
                const result = await service.createLaunch(
                    authorization,
                    parsed.data.design_id,
                    parsed.data.actor
                        ? { kind: parsed.data.actor.kind, userId: parsed.data.actor.user_id }
                        : null,
                );
                return json(200, result);
            }
            return json(404, { error: "Not found" });
        } catch (error) {
            if (error instanceof IntegrationError) return json(error.status, { error: error.message });
            const message = error instanceof Error ? error.message : "error";
            deps.log?.("integrations_error", { message: redactSecrets(message) });
            return json(500, { error: "Internal Server Error" });
        }
    };
}

async function readBody(request: Request): Promise<unknown> {
    const text = await request.text();
    if (!text.trim()) throw new IntegrationError(422, "Request body must be a JSON object");
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new IntegrationError(422, "Request body must be a JSON object");
    }
}

let bound: ((request: Request) => Promise<Response>) | null = null;

export function bindIntegrationHandler(deps: IntegrationDeps): void {
    bound = createIntegrationHandler(deps);
}

export async function handleIntegrationFetch(request: Request, deps?: IntegrationDeps): Promise<Response> {
    const handler = deps ? createIntegrationHandler(deps) : bound;
    if (!handler) return json(503, { error: "Integration API is not configured" });
    return handler(request);
}

export function integrationService(deps: IntegrationDeps) {
    return createIntegrationService(deps);
}

export type { SessionUser, ShoeSystem };
