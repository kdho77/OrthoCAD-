// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Launch-connector use cases. Tenant allowlist is checked before any write.
// A missing tenant is refused. This service never creates a tenant.

import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { DOGFOOD_TENANT_ID } from "../../auth/cad-operator.js";
import { hashIntegrationKey } from "../../auth/integration-keys.js";
import type { DesignExportedEvent, ExportedFile } from "../../webhooks/design-exported.js";
import { buildDesignExportedEvent } from "../../webhooks/design-exported.js";
import type {
    CredentialRecord,
    DesignLinkRecord,
    DesignRecord,
    DesignSides,
    DesignType,
    IntegrationSource,
    IntegrationStore,
    ScanFormat,
    ScanSide,
    ShoeSize,
    UploadRecord,
    UserRecord,
} from "./store.js";
import {
    INTEGRATION_SOURCES,
    LAUNCH_TTL_MS,
    SCAN_BYTES_MAX,
    StoreConflict,
    UPLOAD_URL_TTL_MS,
} from "./store.js";

export class IntegrationError extends Error {
    readonly status: 401 | 403 | 404 | 422;
    constructor(status: 401 | 403 | 404 | 422, message: string) {
        super(message);
        this.name = "IntegrationError";
        this.status = status;
    }
}

export interface SessionUser {
    id: string;
    role: string;
    tenantId: string | null;
}

export interface IntegrationDeps {
    store: IntegrationStore;
    now: () => Date;
    uploadSigningKey: string;
    uploadBaseUrl: string;
    appOrigin: string;
    log?: (event: string, fields: Record<string, string | number>) => void;
}

export interface UpsertClientInput {
    source: IntegrationSource;
    tenantId: string;
    externalClientId: string;
    firstName: string;
    lastName: string;
    dob: string | null;
    shoe: ShoeSize;
}

export interface CreateDesignInput {
    source: IntegrationSource;
    tenantId: string;
    clientId: string;
    externalOrderId: string;
    type: DesignType;
    sides: DesignSides;
    rxText: string | null;
    notes: string | null;
    orderReference: string | null;
    orderedByAccount: string | null;
    parentExternalOrderId: string | null;
    shoe: ShoeSize | null;
    scanSides: ScanSide[];
}

export interface CompleteScanInput {
    side: ScanSide;
    fileName: string;
    format: ScanFormat;
    sizeBytes: number;
}

export interface LaunchActorInput {
    kind: "clinic" | "vertex_staff";
    userId?: string;
}

function sameShoe(a: ShoeSize, b: ShoeSize): boolean {
    const close = (left: number | null, right: number | null) => {
        if (left == null && right == null) return true;
        if (left == null || right == null) return false;
        return Math.abs(left - right) < 1e-6;
    };
    return (
        a.system === b.system &&
        a.width === b.width &&
        close(a.size, b.size) &&
        close(a.left, b.left) &&
        close(a.right, b.right)
    );
}

function parseIntegrationSource(value: string): IntegrationSource {
    if ((INTEGRATION_SOURCES as readonly string[]).includes(value)) return value as IntegrationSource;
    throw new IntegrationError(422, "source is required");
}

/** CAD read shape. Notes, rx text, and patient fields stay off this response. */
function publicIntegrationDesign(link: DesignLinkRecord, design: DesignRecord) {
    return {
        design_id: design.id,
        tenant_id: link.tenantId,
        source: link.source,
        external_order_id: link.externalOrderId,
        type: link.kind,
        sides: link.sides,
        client_id: link.clientId,
        updated_at: design.updatedAt,
        name: design.name,
    };
}

function designNotes(notes: string | null, rxText: string | null): string {
    const text = [notes, rxText].filter((part) => part?.trim()).join("\n");
    return text.slice(0, 500);
}

function signUpload(base: string, key: string, expSec: number, signingKey: string): string {
    const sig = createHmac("sha256", signingKey).update(`${key}.${expSec}`).digest("hex");
    return `${base.replace(/\/+$/, "")}/${key}?exp=${expSec}&sig=${sig}`;
}

function uploadSides(sides: DesignSides, declared: ScanSide[]): ScanSide[] {
    const set = new Set<ScanSide>();
    if (sides === "pair" || sides === "left") set.add("left");
    if (sides === "pair" || sides === "right") set.add("right");
    for (const side of declared) set.add(side);
    return [...set];
}

export function createIntegrationService(deps: IntegrationDeps) {
    const { store } = deps;

    async function requireCredential(authorization: string | undefined): Promise<CredentialRecord> {
        if (!authorization?.startsWith("Bearer ")) {
            throw new IntegrationError(401, "Authentication required");
        }
        const token = authorization.slice("Bearer ".length).trim();
        if (!token.startsWith("ocad_") || /\s/.test(token)) {
            throw new IntegrationError(401, "Authentication required");
        }
        const credential = await store.findCredentialByHash(hashIntegrationKey(token));
        if (!credential || credential.revokedAt) throw new IntegrationError(401, "Authentication required");
        return credential;
    }

    async function requireTenant(credential: CredentialRecord, tenantId: string): Promise<void> {
        if (!credential.tenantIds.includes(tenantId)) {
            throw new IntegrationError(403, "tenant_id is not allowed for this credential");
        }
        if (!(await store.tenantExists(tenantId))) {
            throw new IntegrationError(403, "Unknown tenant");
        }
    }

    async function applyShoe(
        clientId: string,
        linkId: string,
        chartDeclared: boolean,
        chartShoe: ShoeSize,
        order: ShoeSize,
    ) {
        if (!chartDeclared) {
            await store.fillChart(clientId, order);
            await store.setClientLinkShoe(linkId, order, false);
            return false;
        }
        const mismatch = !sameShoe(chartShoe, order);
        await store.setClientLinkShoe(linkId, order, mismatch);
        return mismatch;
    }

    async function issueUploads(
        link: DesignLinkRecord,
        declared: ScanSide[],
    ): Promise<Record<string, string>> {
        const expires = new Date(deps.now().getTime() + UPLOAD_URL_TTL_MS);
        const expSec = Math.floor(expires.getTime() / 1000);
        const urls: Record<string, string> = {};
        const rows: UploadRecord[] = [];
        for (const side of uploadSides(link.sides, declared)) {
            const id = randomUUID();
            const nonce = randomBytes(8).toString("hex");
            const storageKey = `integrations/${link.tenantId}/${link.designId}/${side}/${nonce}`;
            const uploadUrl = signUpload(deps.uploadBaseUrl, storageKey, expSec, deps.uploadSigningKey);
            urls[side] = uploadUrl;
            rows.push({
                id,
                designLinkId: link.id,
                side,
                storageKey,
                uploadUrl,
                expiresAt: expires.toISOString(),
                completedAt: null,
                format: null,
                fileName: null,
                sizeBytes: null,
            });
        }
        await store.replaceOpenUploads(link.id, rows);
        return urls;
    }

    return {
        async upsertClient(authorization: string | undefined, input: UpsertClientInput) {
            const credential = await requireCredential(authorization);
            await requireTenant(credential, input.tenantId);

            const existing = await store.findClientLink({
                source: input.source,
                tenantId: input.tenantId,
                externalClientId: input.externalClientId,
            });
            if (existing) {
                const client = await store.findClient(existing.clientId);
                if (!client || client.tenantId !== input.tenantId)
                    throw new IntegrationError(404, "Client not found");
                await store.updateClientIdentity(client.id, {
                    firstName: input.firstName,
                    lastName: input.lastName,
                    dateOfBirth: input.dob,
                });
                const mismatch = await applyShoe(
                    client.id,
                    existing.id,
                    client.chart.declared,
                    client.chart.shoe,
                    input.shoe,
                );
                return { client_id: client.id, shoe_size_mismatch: mismatch };
            }

            const owner = await store.ownerForTenant(input.tenantId);
            if (!owner) throw new IntegrationError(422, "Tenant has no user to own the client file");
            const clientId = randomUUID();
            const linkId = randomUUID();
            try {
                await store.createClientWithLink({
                    client: {
                        id: clientId,
                        tenantId: input.tenantId,
                        ownerId: owner.id,
                        firstName: input.firstName,
                        lastName: input.lastName,
                        dateOfBirth: input.dob,
                        chart: { declared: true, shoe: input.shoe },
                    },
                    link: {
                        id: linkId,
                        source: input.source,
                        tenantId: input.tenantId,
                        externalClientId: input.externalClientId,
                        clientId,
                        orderShoe: input.shoe,
                        shoeSizeMismatch: false,
                    },
                });
            } catch (error) {
                if (!(error instanceof StoreConflict)) throw error;
                const raced = await store.findClientLink({
                    source: input.source,
                    tenantId: input.tenantId,
                    externalClientId: input.externalClientId,
                });
                if (!raced) throw error;
                return { client_id: raced.clientId, shoe_size_mismatch: raced.shoeSizeMismatch };
            }
            return { client_id: clientId, shoe_size_mismatch: false };
        },

        async createDesign(authorization: string | undefined, input: CreateDesignInput) {
            const credential = await requireCredential(authorization);
            await requireTenant(credential, input.tenantId);
            const client = await store.findClient(input.clientId);
            if (!client || client.tenantId !== input.tenantId)
                throw new IntegrationError(404, "Client not found");

            const existing = await store.findDesignLink({
                source: input.source,
                tenantId: input.tenantId,
                externalOrderId: input.externalOrderId,
            });
            if (existing) {
                if (existing.tenantId !== input.tenantId) throw new IntegrationError(404, "Design not found");
                const upload_urls = await issueUploads(existing, input.scanSides);
                return {
                    design_id: existing.designId,
                    upload_urls,
                    shoe_size_mismatch: existing.shoeSizeMismatch,
                };
            }

            let parentDesignId: string | null = null;
            let parentNotes: string | null = null;
            if (input.parentExternalOrderId) {
                const parent = await store.findDesignLink({
                    source: input.source,
                    tenantId: input.tenantId,
                    externalOrderId: input.parentExternalOrderId,
                });
                if (!parent) throw new IntegrationError(422, "parent order was not found");
                const parentDesign = await store.getDesign(parent.designId);
                if (!parentDesign || parentDesign.tenantId !== input.tenantId) {
                    throw new IntegrationError(422, "parent order was not found");
                }
                parentDesignId = parentDesign.id;
                parentNotes = parentDesign.notes || null;
            }
            const notes = input.notes ?? parentNotes;

            const clientLink = await store.findClientLinkByClient(input.source, input.tenantId, client.id);
            const orderShoe = input.shoe ?? clientLink?.orderShoe ?? client.chart.shoe;
            const mismatch = input.shoe
                ? client.chart.declared && !sameShoe(client.chart.shoe, input.shoe)
                : (clientLink?.shoeSizeMismatch ?? false);
            if (!client.chart.declared) await store.fillChart(client.id, orderShoe);

            const owner = await store.ownerForTenant(input.tenantId);
            if (!owner) throw new IntegrationError(422, "Tenant has no user to own the client file");
            const designId = randomUUID();
            const linkId = randomUUID();
            const nowIso = deps.now().toISOString();
            const link: DesignLinkRecord = {
                id: linkId,
                source: input.source,
                tenantId: input.tenantId,
                externalOrderId: input.externalOrderId,
                designId,
                clientId: client.id,
                kind: input.type,
                sides: input.sides,
                rxText: input.rxText,
                notes,
                orderReference: input.orderReference,
                orderedByAccount: input.orderedByAccount,
                parentExternalOrderId: input.parentExternalOrderId,
                parentDesignId,
                shoe: orderShoe,
                shoeSizeMismatch: mismatch,
            };
            try {
                await store.createDesignWithLink({
                    design: {
                        id: designId,
                        clientId: client.id,
                        tenantId: input.tenantId,
                        ownerId: owner.id,
                        kind: input.type,
                        name: `${input.type === "afo" ? "AFO" : "Insole"} ${input.externalOrderId}`.slice(
                            0,
                            120,
                        ),
                        notes: designNotes(notes, input.rxText),
                        updatedAt: nowIso,
                    },
                    link,
                });
            } catch (error) {
                if (!(error instanceof StoreConflict)) throw error;
                const raced = await store.findDesignLink({
                    source: input.source,
                    tenantId: input.tenantId,
                    externalOrderId: input.externalOrderId,
                });
                if (!raced) throw error;
                const upload_urls = await issueUploads(raced, input.scanSides);
                return { design_id: raced.designId, upload_urls, shoe_size_mismatch: raced.shoeSizeMismatch };
            }
            const upload_urls = await issueUploads(link, input.scanSides);
            return { design_id: designId, upload_urls, shoe_size_mismatch: mismatch };
        },

        async completeScans(authorization: string | undefined, designId: string, scans: CompleteScanInput[]) {
            const credential = await requireCredential(authorization);
            const link = await store.findDesignLinkByDesignId(designId);
            if (!link || !credential.tenantIds.includes(link.tenantId)) {
                throw new IntegrationError(404, "Design not found");
            }
            if (!(await store.tenantExists(link.tenantId))) throw new IntegrationError(403, "Unknown tenant");
            const uploads = await store.listUploads(link.id);
            const completed: string[] = [];
            for (const scan of scans) {
                if (scan.sizeBytes > SCAN_BYTES_MAX) {
                    throw new IntegrationError(422, "Scan file is too large (max 100 MB)");
                }
                const match = [...uploads].reverse().find((row) => row.side === scan.side);
                if (!match) throw new IntegrationError(422, "scan side was not declared");
                if (
                    match.completedAt &&
                    match.fileName === scan.fileName &&
                    match.sizeBytes === scan.sizeBytes
                ) {
                    completed.push(match.id);
                    continue;
                }
                const completedAt = deps.now().toISOString();
                await store.completeUpload(match.id, {
                    format: scan.format,
                    fileName: scan.fileName,
                    sizeBytes: scan.sizeBytes,
                    completedAt,
                });
                if (scan.side === "left" || scan.side === "right") {
                    const prior = await store.findScanByStorageKey(match.storageKey);
                    if (!prior) {
                        await store.insertScan({
                            id: randomUUID(),
                            designId: link.designId,
                            tenantId: link.tenantId,
                            side: scan.side,
                            fileName: scan.fileName,
                            storageKey: match.storageKey,
                            format: scan.format,
                            sizeBytes: scan.sizeBytes,
                        });
                    }
                }
                completed.push(match.id);
            }
            return { design_id: link.designId, completed: completed.length };
        },

        async createLaunch(
            authorization: string | undefined,
            designId: string,
            actor: LaunchActorInput | null,
        ) {
            const credential = await requireCredential(authorization);
            const link = await store.findDesignLinkByDesignId(designId);
            if (!link || !credential.tenantIds.includes(link.tenantId)) {
                throw new IntegrationError(404, "Design not found");
            }
            const issued = await issueLaunch(store, deps.now(), link.tenantId, link.designId, actor);
            const origin = deps.appOrigin.replace(/\/+$/, "");
            return { url: `${origin}/launch?token=${issued.token}` };
        },

        async redeemLaunch(token: string, session: SessionUser | null) {
            const now = deps.now();
            const row = await store.findLaunchByHash(hashIntegrationKey(token));
            if (!row) throw new IntegrationError(422, "launch link is invalid");
            if (row.usedAt) throw new IntegrationError(422, "launch link already used");
            if (new Date(row.expiresAt).getTime() <= now.getTime()) {
                throw new IntegrationError(422, "launch link expired");
            }
            if (row.actorRole === "super_admin") {
                throw new IntegrationError(403, "launch cannot use super admin");
            }
            const marked = await store.markLaunchUsed(row.tokenHash, now.toISOString());
            if (!marked) throw new IntegrationError(422, "launch link already used");
            if (!session) {
                return {
                    design_id: row.designId,
                    tenant_id: row.tenantId,
                    sign_in_required: true,
                    actor: null,
                };
            }
            if (session.role !== "super_admin" && session.tenantId === row.tenantId) {
                return {
                    design_id: row.designId,
                    tenant_id: row.tenantId,
                    sign_in_required: false,
                    actor: {
                        kind: "clinic" as const,
                        user_id: session.id,
                        role: session.role,
                        tenant_id: row.tenantId,
                    },
                };
            }
            const vertexStaff = session.role === "super_admin" || session.tenantId == null;
            if (!vertexStaff) throw new IntegrationError(403, "user is not in this tenant");
            return {
                design_id: row.designId,
                tenant_id: row.tenantId,
                sign_in_required: false,
                actor: {
                    kind: "vertex_staff" as const,
                    user_id: session.id,
                    role: "admin" as const,
                    tenant_id: row.tenantId,
                },
            };
        },

        async getDesignForCredential(authorization: string | undefined, designId: string) {
            const credential = await requireCredential(authorization);
            if (!credential.tenantIds.includes(DOGFOOD_TENANT_ID)) {
                throw new IntegrationError(401, "Authentication required");
            }
            const link = await store.findDesignLinkByDesignId(designId);
            const design = link ? await store.getDesign(link.designId) : null;
            if (
                !link ||
                !design ||
                link.tenantId !== DOGFOOD_TENANT_ID ||
                design.tenantId !== DOGFOOD_TENANT_ID ||
                !credential.tenantIds.includes(link.tenantId)
            ) {
                throw new IntegrationError(404, "Design not found");
            }
            return publicIntegrationDesign(link, design);
        },

        async listDesignsForCredential(
            authorization: string | undefined,
            query: { source: string; tenantId: string; externalOrderId: string },
        ) {
            const credential = await requireCredential(authorization);
            if (!credential.tenantIds.includes(DOGFOOD_TENANT_ID)) {
                throw new IntegrationError(401, "Authentication required");
            }
            if (query.tenantId !== DOGFOOD_TENANT_ID) {
                throw new IntegrationError(404, "Design not found");
            }
            const source = parseIntegrationSource(query.source);
            if (!query.externalOrderId.trim()) {
                throw new IntegrationError(422, "external_order_id is required");
            }
            const link = await store.findDesignLink({
                source,
                tenantId: DOGFOOD_TENANT_ID,
                externalOrderId: query.externalOrderId.trim(),
            });
            if (!link) return { designs: [] };
            const design = await store.getDesign(link.designId);
            if (!design || design.tenantId !== DOGFOOD_TENANT_ID) return { designs: [] };
            return { designs: [publicIntegrationDesign(link, design)] };
        },

        async queueDesignExported(input: {
            tenantId: string;
            designId: string;
            source: IntegrationSource;
            externalOrderId: string;
            files: ExportedFile[];
        }): Promise<DesignExportedEvent> {
            const link = await store.findDesignLinkByDesignId(input.designId);
            if (!link || link.tenantId !== input.tenantId)
                throw new IntegrationError(404, "Design not found");
            const event = buildDesignExportedEvent({
                id: randomUUID(),
                tenantId: input.tenantId,
                designId: input.designId,
                source: input.source,
                externalOrderId: input.externalOrderId,
                files: input.files,
            });
            await store.insertWebhookEvent({
                id: event.id,
                type: "design.exported",
                tenantId: input.tenantId,
                designId: input.designId,
                payload: event,
                attemptCount: 0,
                nextAttemptAt: null,
                deliveredAt: null,
            });
            return event;
        },
    };
}

async function issueLaunch(
    store: IntegrationStore,
    now: Date,
    tenantId: string,
    designId: string,
    actor: LaunchActorInput | null,
): Promise<{ token: string }> {
    let actorKind: "clinic" | "vertex_staff" = "clinic";
    let actorRole = "clinician";
    let actorUserId: string | null = null;
    if (actor?.kind === "vertex_staff") {
        actorKind = "vertex_staff";
        actorRole = "admin";
        actorUserId = actor.userId ?? null;
        if (actor.userId) {
            const user = await store.findUser(actor.userId);
            if (user?.role === "super_admin") actorUserId = user.id;
        }
    } else if (actor?.kind === "clinic" && actor.userId) {
        const user: UserRecord | null = await store.findUser(actor.userId);
        if (!user || user.tenantId !== tenantId) {
            throw new IntegrationError(422, "clinic user is not in this tenant");
        }
        if (user.role === "super_admin")
            throw new IntegrationError(403, "clinic launch cannot use super admin");
        actorKind = "clinic";
        actorRole = user.role;
        actorUserId = user.id;
    }
    if (actorRole === "super_admin") throw new IntegrationError(403, "launch cannot use super admin");
    const token = `ocad_launch_${randomBytes(32).toString("base64url")}`;
    await store.insertLaunch({
        tokenHash: hashIntegrationKey(token),
        tenantId,
        designId,
        actorKind,
        actorUserId,
        actorRole,
        expiresAt: new Date(now.getTime() + LAUNCH_TTL_MS).toISOString(),
        usedAt: null,
    });
    return { token };
}
