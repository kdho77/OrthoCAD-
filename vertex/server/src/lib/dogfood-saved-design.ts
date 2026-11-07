// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Refresh a bound dogfood SAMPLE_Top design, or establish one after the server
// order-owner verifier accepts the person. Caller ids are not authority.
// No scan upload and no STL. The default verifier denies.

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertDogfoodNotHeld } from "../../../shared/dogfood-holds.js";
import {
    buildSavedDesignSnapshot,
    type SavedDesignSnapshotBuild,
} from "../../../shared/saved-design-snapshot.js";
import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { settingsEnvelopeForSave } from "./design-schema.js";
import { classifyOrderPersonEvidence } from "./dogfood-order-person-boundary.js";
import {
    acceptVerifiedOrderPerson,
    dogfoodOrderPersonRequest,
    type OrderPersonVerifier,
    orderPersonStillFresh,
    unconfiguredOrderPersonVerifier,
    type VerifiedOrderPerson,
} from "./dogfood-order-person-verifier.js";
import type { PersistSavedDesignSnapshotResult } from "./saved-design-snapshot.js";

export const DOGFOOD_ORDER_IDENTITY_CODES = [
    "order_person_unbound",
    "order_client_mismatch",
    "order_client_ambiguous",
    "order_client_cross_tenant",
    "order_identity_invalid",
    "verifier_revoked",
    "verifier_unauthorized",
    "verifier_untrusted",
    "verifier_stale",
    "verifier_incomplete",
] as const;

export type DogfoodOrderIdentityCode = (typeof DOGFOOD_ORDER_IDENTITY_CODES)[number];

/**
 * First-time establishment is refused.
 * Integration client upsert trusts a caller-supplied external client id under a
 * tenant allowlist. That is not proof the id is the person on this order, and
 * CAD-operator scopes cannot assert it. No order-person column exists until a
 * design link does. A new permission plus a server-verified vo2 person id for
 * the order would be required before a client or design may be created here.
 */
export class DogfoodOrderIdentityError extends Error {
    readonly code: DogfoodOrderIdentityCode;

    constructor(code: DogfoodOrderIdentityCode, detail: string) {
        super(`${code}: ${detail}`);
        this.name = "DogfoodOrderIdentityError";
        this.code = code;
    }
}

export interface DogfoodSavedDesignCreateResult extends PersistSavedDesignSnapshotResult {
    created: boolean;
    established: boolean;
    identity: "existing_order_binding" | "verified_order_person";
    external_order_id: string;
    client_id: string;
}

export interface DogfoodOrderLink {
    designId: string;
    clientId: string;
}

interface DogfoodClient {
    id: string;
    ownerId: string;
    tenantId: string;
}

export interface DogfoodPersonLink {
    clientId: string;
    givenName: string;
    familyName: string;
}

export interface EstablishVerifiedOrderInput {
    externalOrderId: string;
    externalPersonId: string;
    givenName: string;
    familyName: string;
    verifiedAt: string;
    now: Date;
    settingsJson: unknown;
    linkShoe: { system: "US_M" | "US_W"; size: number; left: number | null; right: number | null };
    /** Empty when width was defaulted. The settings snapshot keeps the provenance. */
    linkShoeWidth: string;
    chartWidth: "narrow" | "medium" | "wide";
}

export type EstablishVerifiedOrderResult =
    | { outcome: "created"; clientId: string; designId: string; createdClient: boolean }
    | { outcome: "exists"; clientId: string; designId: string }
    | { outcome: "conflict" }
    | { outcome: "mismatch" }
    | { outcome: "ambiguous" }
    | { outcome: "stale" }
    | { outcome: "no_owner" };

export interface DogfoodSavedDesignStore {
    /** At most two rows. A second row means the order binding is ambiguous. */
    findOrderLinks(externalOrderId: string): Promise<DogfoodOrderLink[]>;
    /** Dogfood tenant only. Any other tenant is absent here. */
    findClient(clientId: string): Promise<DogfoodClient | null>;
    /** At most two rows for one vo2 dogfood person id. */
    findPersonLinks?(externalPersonId: string): Promise<DogfoodPersonLink[]>;
    /**
     * One transaction: re-read, then insert the missing client link and design
     * link together. A unique conflict rolls the transaction back.
     */
    establishVerifiedOrder?(input: EstablishVerifiedOrderInput): Promise<EstablishVerifiedOrderResult>;
}

const CLIENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sameId(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function requireOrderId(value: string): string {
    const externalOrderId = value.trim();
    if (!externalOrderId || externalOrderId.length > 200) {
        throw new DogfoodOrderIdentityError(
            "order_identity_invalid",
            "external_order_id is required and must be at most 200 characters.",
        );
    }
    assertDogfoodNotHeld(externalOrderId);
    return externalOrderId;
}

function requireConfirmingClientId(value: string | null | undefined): string | null {
    if (value == null || value === "") return null;
    const clientId = value.trim();
    if (!CLIENT_UUID.test(clientId)) {
        throw new DogfoodOrderIdentityError(
            "order_identity_invalid",
            "client_id must be a uuid when it is sent. It does not establish identity.",
        );
    }
    assertDogfoodNotHeld(clientId);
    return clientId;
}

const UNBOUND =
    "No vo2 dogfood design is linked to this order. A client UUID, name, or external client id from the caller is not the order's person. This path does not create a client or a design, and it does not call integration client upsert.";

function refusalMessage(code: DogfoodOrderIdentityCode): string {
    switch (code) {
        case "verifier_revoked":
            return "The order-owner verifier is revoked. No client or design was written.";
        case "verifier_unauthorized":
            return "The verifier is not the authorized order-owner principal. No client or design was written.";
        case "verifier_untrusted":
            return "The verifier result does not match this dogfood order. No client or design was written.";
        case "verifier_stale":
            return "The order-owner verification is stale. No client or design was written.";
        case "verifier_incomplete":
            return "The order-owner verification has no name for a new client. No client or design was written.";
        case "order_client_mismatch":
            return "client_id does not match the client already bound to this order. No design was written and the client tenant was not changed.";
        case "order_client_ambiguous":
            return "More than one vo2 dogfood design is linked to this order. No design was written.";
        case "order_client_cross_tenant":
            return "The client bound to this order is not in the dogfood tenant. No design was written and the client tenant was not changed.";
        default:
            return UNBOUND;
    }
}

function identityError(code: DogfoodOrderIdentityCode): DogfoodOrderIdentityError {
    return new DogfoodOrderIdentityError(code, refusalMessage(code));
}

function chartWidth(width: string, source: "prescribed" | "defaulted"): "narrow" | "medium" | "wide" {
    if (source === "prescribed" && (width === "narrow" || width === "medium" || width === "wide"))
        return width;
    return "medium";
}

function envelopeFor(built: SavedDesignSnapshotBuild): unknown {
    try {
        return settingsEnvelopeForSave(built.design);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`snapshot is not loftable (${message}). Refusing to write.`);
    }
}

function isConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Refresh a bound design, or establish one after the server verifier accepts
 * the order's person. Caller ids and names are not authority.
 */
export async function createDogfoodSavedDesign(args: {
    principal: CadOperatorPrincipal;
    externalOrderId: string;
    clientId?: string | null;
    catalog?: unknown;
    store: DogfoodSavedDesignStore;
    verifier?: OrderPersonVerifier;
    now?: () => Date;
    buildSnapshot?: typeof buildSavedDesignSnapshot;
    persist: (designId: string) => Promise<PersistSavedDesignSnapshotResult>;
}): Promise<DogfoodSavedDesignCreateResult> {
    if (args.principal.tenantId !== DOGFOOD_TENANT_ID) {
        throw new Error("Design not found");
    }
    const externalOrderId = requireOrderId(args.externalOrderId);
    const confirmingClientId = requireConfirmingClientId(args.clientId);
    const now = (args.now ?? (() => new Date()))();
    const verifier = args.verifier ?? unconfiguredOrderPersonVerifier;
    const request = dogfoodOrderPersonRequest(externalOrderId);
    const accepted = acceptVerifiedOrderPerson(await verifier.verify(request), request, now);
    if (!accepted.ok) {
        if (accepted.code !== "verifier_unconfigured") throw identityError(accepted.code);
        return refreshStoredBinding(args, externalOrderId, confirmingClientId);
    }
    if (!orderPersonStillFresh(accepted.person, now)) throw identityError("verifier_stale");
    return bindVerifiedPerson(args, accepted.person, externalOrderId, confirmingClientId, now);
}

async function refreshStoredBinding(
    args: {
        store: DogfoodSavedDesignStore;
        persist: (designId: string) => Promise<PersistSavedDesignSnapshotResult>;
    },
    externalOrderId: string,
    confirmingClientId: string | null,
): Promise<DogfoodSavedDesignCreateResult> {
    const links = await args.store.findOrderLinks(externalOrderId);
    if (links.length > 1) throw identityError("order_client_ambiguous");
    const link = links[0];
    if (!link) {
        const decision = classifyOrderPersonEvidence({
            kind: "cad_operator_request",
            externalOrderId,
            clientId: confirmingClientId,
        });
        if (decision.established || decision.writes !== "none" || decision.code !== "order_person_unbound") {
            throw identityError("order_person_unbound");
        }
        throw identityError("order_person_unbound");
    }
    if (confirmingClientId && !sameId(confirmingClientId, link.clientId)) {
        throw identityError("order_client_mismatch");
    }
    const client = await args.store.findClient(link.clientId);
    if (!client || client.tenantId !== DOGFOOD_TENANT_ID) throw identityError("order_client_cross_tenant");
    if (!sameId(client.id, link.clientId)) throw identityError("order_client_mismatch");
    assertDogfoodNotHeld(link.designId);
    const persisted = await args.persist(link.designId);
    return {
        ...persisted,
        created: false,
        established: false,
        identity: "existing_order_binding",
        external_order_id: externalOrderId,
        client_id: client.id,
    };
}

async function bindVerifiedPerson(
    args: {
        catalog?: unknown;
        store: DogfoodSavedDesignStore;
        buildSnapshot?: typeof buildSavedDesignSnapshot;
        persist: (designId: string) => Promise<PersistSavedDesignSnapshotResult>;
    },
    person: VerifiedOrderPerson,
    externalOrderId: string,
    confirmingClientId: string | null,
    now: Date,
): Promise<DogfoodSavedDesignCreateResult> {
    if (!args.store.findPersonLinks || !args.store.establishVerifiedOrder) {
        throw identityError("order_person_unbound");
    }
    const orders = await args.store.findOrderLinks(externalOrderId);
    const people = await args.store.findPersonLinks(person.externalPersonId);
    if (orders.length > 1 || people.length > 1) throw identityError("order_client_ambiguous");
    const order = orders[0] ?? null;
    const existingPerson = people[0] ?? null;
    if (confirmingClientId && (!existingPerson || !sameId(confirmingClientId, existingPerson.clientId))) {
        throw identityError("order_client_mismatch");
    }
    if (order && (!existingPerson || !sameId(order.clientId, existingPerson.clientId))) {
        throw identityError("order_client_mismatch");
    }
    if (order && existingPerson) {
        const client = await args.store.findClient(order.clientId);
        if (!client || client.tenantId !== DOGFOOD_TENANT_ID)
            throw identityError("order_client_cross_tenant");
        assertDogfoodNotHeld(order.designId);
        const persisted = await args.persist(order.designId);
        return {
            ...persisted,
            created: false,
            established: false,
            identity: "existing_order_binding",
            external_order_id: externalOrderId,
            client_id: client.id,
        };
    }
    if (!person.givenName || !person.familyName) {
        if (!existingPerson) throw identityError("verifier_incomplete");
    }
    const built = await snapshotForNewDesign(args.catalog, args.buildSnapshot);
    const settingsJson = envelopeFor(built);
    if (!orderPersonStillFresh(person, now)) throw identityError("verifier_stale");
    const established = await commitVerified(args.store, {
        externalOrderId,
        externalPersonId: person.externalPersonId,
        givenName: existingPerson?.givenName ?? person.givenName ?? "",
        familyName: existingPerson?.familyName ?? person.familyName ?? "",
        verifiedAt: person.verifiedAt,
        now,
        settingsJson,
        linkShoe: built.linkShoe,
        linkShoeWidth: built.shoeWidthSource === "prescribed" ? built.shoeWidth : "",
        chartWidth: chartWidth(built.shoeWidth, built.shoeWidthSource),
    });
    if (established.outcome === "created") {
        return {
            ok: true,
            created: true,
            established: true,
            identity: "verified_order_person",
            design_id: established.designId,
            external_order_id: externalOrderId,
            client_id: established.clientId,
            ignored_fields: built.ignoredFields,
            unmapped_fields: built.ignoredFields,
            paths: built.paths,
            settingsJson,
            template: "SAMPLE_Top",
            scans_used: false,
            shoe_width: built.shoeWidth,
            shoe_width_source: built.shoeWidthSource,
            hardness: built.hardness,
            hardness_source: built.hardnessSource,
        };
    }
    if (established.outcome === "exists") {
        return {
            ok: true,
            created: false,
            established: false,
            identity: "existing_order_binding",
            design_id: established.designId,
            external_order_id: externalOrderId,
            client_id: established.clientId,
            ignored_fields: built.ignoredFields,
            unmapped_fields: built.ignoredFields,
            paths: built.paths,
            settingsJson,
            template: "SAMPLE_Top",
            scans_used: false,
            shoe_width: built.shoeWidth,
            shoe_width_source: built.shoeWidthSource,
            hardness: built.hardness,
            hardness_source: built.hardnessSource,
        };
    }
    if (established.outcome === "ambiguous") throw identityError("order_client_ambiguous");
    if (established.outcome === "stale") throw identityError("verifier_stale");
    if (established.outcome === "no_owner") throw identityError("order_person_unbound");
    throw identityError("order_client_mismatch");
}

async function snapshotForNewDesign(
    catalog: unknown,
    buildSnapshot: typeof buildSavedDesignSnapshot | undefined,
): Promise<SavedDesignSnapshotBuild> {
    const build = buildSnapshot ?? buildSavedDesignSnapshot;
    const { parseSavedDesignCatalog } = await import("../../../shared/saved-design-catalog.js");
    return build({ stored: null, catalog: parseSavedDesignCatalog(catalog) });
}

async function commitVerified(
    store: DogfoodSavedDesignStore,
    input: EstablishVerifiedOrderInput,
): Promise<EstablishVerifiedOrderResult> {
    const establish = store.establishVerifiedOrder;
    if (!establish) throw identityError("order_person_unbound");
    let result = await establish(input);
    if (result.outcome === "conflict") result = await establish(input);
    return result;
}

export function prismaDogfoodSavedDesignStore(prisma: PrismaClient): DogfoodSavedDesignStore {
    return {
        async findOrderLinks(externalOrderId) {
            const rows = await prisma.integrationDesign.findMany({
                where: {
                    source: "vo2",
                    tenantId: DOGFOOD_TENANT_ID,
                    externalOrderId,
                },
                select: { designId: true, clientId: true },
                take: 2,
            });
            return rows;
        },
        async findClient(clientId) {
            const row = await prisma.client.findFirst({
                where: { id: clientId, tenantId: DOGFOOD_TENANT_ID },
                select: { id: true, ownerId: true, tenantId: true },
            });
            if (!row?.tenantId || row.tenantId !== DOGFOOD_TENANT_ID) return null;
            return { id: row.id, ownerId: row.ownerId, tenantId: row.tenantId };
        },
        async findPersonLinks(externalPersonId) {
            const rows = await prisma.integrationClient.findMany({
                where: { source: "vo2", tenantId: DOGFOOD_TENANT_ID, externalClientId: externalPersonId },
                select: {
                    clientId: true,
                    client: { select: { firstName: true, lastName: true, tenantId: true } },
                },
                take: 2,
            });
            return rows
                .filter((row) => row.client.tenantId === DOGFOOD_TENANT_ID)
                .map((row) => ({
                    clientId: row.clientId,
                    givenName: row.client.firstName,
                    familyName: row.client.lastName,
                }));
        },
        async establishVerifiedOrder(input) {
            if (
                !orderPersonStillFresh(
                    {
                        principal: "vo-order-owner",
                        source: "vo2",
                        tenantId: DOGFOOD_TENANT_ID,
                        externalOrderId: input.externalOrderId,
                        externalPersonId: input.externalPersonId,
                        audience: "dogfood-saved-design",
                        operation: "bind-order-person",
                        verifiedAt: input.verifiedAt,
                        givenName: input.givenName,
                        familyName: input.familyName,
                    },
                    input.now,
                )
            ) {
                return { outcome: "stale" };
            }
            try {
                return await prisma.$transaction(async (tx) => {
                    const orders = await tx.integrationDesign.findMany({
                        where: {
                            source: "vo2",
                            tenantId: DOGFOOD_TENANT_ID,
                            externalOrderId: input.externalOrderId,
                        },
                        select: { designId: true, clientId: true },
                        take: 2,
                    });
                    const people = await tx.integrationClient.findMany({
                        where: {
                            source: "vo2",
                            tenantId: DOGFOOD_TENANT_ID,
                            externalClientId: input.externalPersonId,
                        },
                        select: { clientId: true },
                        take: 2,
                    });
                    if (orders.length > 1 || people.length > 1) return { outcome: "ambiguous" as const };
                    const order = orders[0] ?? null;
                    const person = people[0] ?? null;
                    if (order && (!person || order.clientId !== person.clientId))
                        return { outcome: "mismatch" as const };
                    if (order && person) {
                        return {
                            outcome: "exists" as const,
                            clientId: person.clientId,
                            designId: order.designId,
                        };
                    }
                    let ownerId: string | null = null;
                    if (person) {
                        const row = await tx.client.findFirst({
                            where: { id: person.clientId, tenantId: DOGFOOD_TENANT_ID },
                            select: { ownerId: true },
                        });
                        ownerId = row?.ownerId ?? null;
                    } else {
                        const row = await tx.user.findFirst({
                            where: {
                                tenantId: DOGFOOD_TENANT_ID,
                                isActive: true,
                                role: { not: "super_admin" },
                            },
                            orderBy: { createdAt: "asc" },
                            select: { id: true },
                        });
                        ownerId = row?.id ?? null;
                    }
                    if (!ownerId) return { outcome: person ? ("mismatch" as const) : ("no_owner" as const) };
                    const clientId = person?.clientId ?? randomUUID();
                    const designId = randomUUID();
                    if (!person) {
                        await tx.client.create({
                            data: {
                                id: clientId,
                                tenantId: DOGFOOD_TENANT_ID,
                                ownerId,
                                firstName: input.givenName,
                                lastName: input.familyName,
                                displayName: `${input.givenName} ${input.familyName}`.trim(),
                                shoeSizeSystem: input.linkShoe.system,
                                shoeSizeDeclared: true,
                                shoeSizeUs: input.linkShoe.size,
                                shoeSizesSplit: input.linkShoe.left != null || input.linkShoe.right != null,
                                shoeSizeLeftUs: input.linkShoe.left ?? input.linkShoe.size,
                                shoeSizeRightUs: input.linkShoe.right ?? input.linkShoe.size,
                                shoeWidth: input.chartWidth,
                            },
                        });
                        await tx.integrationClient.create({
                            data: {
                                source: "vo2",
                                tenantId: DOGFOOD_TENANT_ID,
                                externalClientId: input.externalPersonId,
                                clientId,
                                shoeSizeSystem: input.linkShoe.system,
                                shoeSize: input.linkShoe.size,
                                shoeSizeLeft: input.linkShoe.left,
                                shoeSizeRight: input.linkShoe.right,
                                shoeWidth: input.chartWidth,
                            },
                        });
                    }
                    await tx.design.create({
                        data: {
                            id: designId,
                            clientId,
                            ownerId,
                            kind: "insole",
                            name: `Insole ${input.externalOrderId}`.slice(0, 120),
                            pattern: "full_contact",
                            method: "printing_solid",
                            settingsJson: input.settingsJson as Prisma.InputJsonValue,
                        },
                    });
                    await tx.integrationDesign.create({
                        data: {
                            source: "vo2",
                            tenantId: DOGFOOD_TENANT_ID,
                            externalOrderId: input.externalOrderId,
                            designId,
                            clientId,
                            kind: "insole",
                            sides: "pair",
                            shoeSizeSystem: input.linkShoe.system,
                            shoeSize: input.linkShoe.size,
                            shoeSizeLeft: input.linkShoe.left,
                            shoeSizeRight: input.linkShoe.right,
                            shoeWidth: input.linkShoeWidth,
                        },
                    });
                    return { outcome: "created" as const, clientId, designId, createdClient: !person };
                });
            } catch (error) {
                if (isConflict(error)) return { outcome: "conflict" };
                throw error;
            }
        },
    };
}
