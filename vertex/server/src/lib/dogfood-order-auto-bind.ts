// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// First-sight bind of one vo2 dogfood order to the person the order-owner
// verifier names. Caller client ids, chart ids, and names are not authority.
// The verifier is the same consumer as create_saved_design. Unconfigured denies.

import { assertDogfoodNotHeld } from "../../../shared/dogfood-holds.js";
import { parseSavedDesignCatalog } from "../../../shared/saved-design-catalog.js";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot.js";
import { DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import { settingsEnvelopeForSave } from "./design-schema.js";
import { runtimeDogfoodOrderOwnerVerifier } from "./dogfood-order-owner-wire.js";
import {
    acceptVerifiedOrderPerson,
    dogfoodOrderPersonRequest,
    type OrderPersonVerifier,
    orderPersonStillFresh,
    unconfiguredOrderPersonVerifier,
    type VerifiedOrderPerson,
} from "./dogfood-order-person-verifier.js";
import {
    DogfoodOrderIdentityError,
    type DogfoodPersonShoe,
    type DogfoodSavedDesignStore,
    dogfoodOrderIdentityDetail,
    dogfoodOrderIdentityRefusal,
    type EstablishVerifiedOrderInput,
    type EstablishVerifiedOrderResult,
    integrationLinkShoeWidth,
    requireDogfoodExternalOrderId,
} from "./dogfood-saved-design.js";

/**
 * Fields the VO order-owner 200 does not carry today.
 * interpretOrderOwnerResponse requires the exact success keys and sets
 * givenName and familyName to null. An extra key is verifier_untrusted,
 * so the producer must not send these until this consumer allows them.
 */
export const DOGFOOD_ORDER_AUTO_BIND_PRODUCER_NAME_FIELDS = ["given_name", "family_name"] as const;

export interface DogfoodOrderIntake {
    /**
     * Labels from the authenticated VO intake payload only.
     * Not a client id and not a CAD-operator chart field.
     */
    names?: { givenName?: string | null; familyName?: string | null } | null;
    shoe?: {
        system: "US_M" | "US_W" | "EU";
        size: number;
        left: number | null;
        right: number | null;
    } | null;
    /** Set only when that payload named narrow, medium, or wide. */
    explicitWidth?: "narrow" | "medium" | "wide" | null;
}

export interface DogfoodOrderAutoBindResult {
    created: boolean;
    established: boolean;
    identity: "existing_order_binding" | "verified_order_person";
    externalOrderId: string;
    clientId: string;
    designId: string;
    createdClient: boolean;
    shoeWidth: "narrow" | "medium" | "wide" | null;
    shoeWidthSource: "prescribed" | "defaulted" | null;
}

/**
 * Gate off. Same order_person_unbound refusal as a missing link.
 * No client, design, or integration row is written.
 */
export class DogfoodOrderAutoBindUnconfiguredError extends DogfoodOrderIdentityError {
    readonly unconfigured = true as const;

    constructor() {
        super("order_person_unbound", dogfoodOrderIdentityDetail("order_person_unbound"));
        this.name = "DogfoodOrderAutoBindUnconfiguredError";
    }
}

type LinkWidth = "narrow" | "medium" | "wide";

function sameId(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function intakeLabel(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 100) return null;
    for (let index = 0; index < trimmed.length; index += 1) {
        if (trimmed.charCodeAt(index) < 32) return null;
    }
    return trimmed;
}

function usableShoe(
    shoe: DogfoodOrderIntake["shoe"] | DogfoodPersonShoe | null | undefined,
): { system: "US_M" | "US_W"; size: number; left: number | null; right: number | null } | null {
    if (!shoe) return null;
    if (shoe.system !== "US_M" && shoe.system !== "US_W") return null;
    if (!Number.isFinite(shoe.size) || shoe.size <= 0) return null;
    return { system: shoe.system, size: shoe.size, left: shoe.left, right: shoe.right };
}

function namedWidth(value: string | null | undefined): LinkWidth | null {
    if (value === "narrow" || value === "medium" || value === "wide") return value;
    return null;
}

function catalogForBind(
    catalog: unknown,
    intake: DogfoodOrderIntake | null | undefined,
    stored: DogfoodPersonShoe | undefined,
): unknown {
    if (catalog !== undefined) return catalog;
    const intakeShoe = usableShoe(intake?.shoe);
    const storedShoe = usableShoe(stored);
    const shoe = intakeShoe ?? storedShoe;
    if (!shoe) return {};
    const body: Record<string, unknown> = {
        shoe_size: {
            system: shoe.system,
            size: shoe.size,
            left: shoe.left,
            right: shoe.right,
        },
    };
    const width = intakeShoe ? namedWidth(intake?.explicitWidth) : namedWidth(stored?.width);
    if (width) body.width = width;
    return body;
}

function envelopeFor(design: unknown): unknown {
    try {
        return settingsEnvelopeForSave(design);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`snapshot is not loftable (${message}). Refusing to write.`);
    }
}

async function commitVerified(
    store: DogfoodSavedDesignStore,
    input: EstablishVerifiedOrderInput,
): Promise<EstablishVerifiedOrderResult> {
    const establish = store.establishVerifiedOrder;
    if (!establish) throw dogfoodOrderIdentityRefusal("order_person_unbound");
    let result = await establish(input);
    if (result.outcome === "conflict") result = await establish(input);
    return result;
}

function lazyPrismaDogfoodSavedDesignStore(): DogfoodSavedDesignStore {
    let loaded: Promise<DogfoodSavedDesignStore> | null = null;
    const load = (): Promise<DogfoodSavedDesignStore> => {
        loaded ??= import("./dogfood-saved-design.js").then(async (mod) => {
            const { prisma } = await import("./prisma.js");
            return mod.prismaDogfoodSavedDesignStore(prisma);
        });
        return loaded;
    };
    return {
        async findOrderLinks(externalOrderId) {
            return (await load()).findOrderLinks(externalOrderId);
        },
        async findClient(clientId) {
            return (await load()).findClient(clientId);
        },
        async findPersonLinks(externalPersonId) {
            const store = await load();
            if (!store.findPersonLinks) return [];
            return store.findPersonLinks(externalPersonId);
        },
        async establishVerifiedOrder(input) {
            const store = await load();
            if (!store.establishVerifiedOrder) return { outcome: "no_owner" };
            return store.establishVerifiedOrder(input);
        },
    };
}

export async function autoBindDogfoodOrder(args: {
    externalOrderId: string;
    store: DogfoodSavedDesignStore;
    verifier?: OrderPersonVerifier;
    now?: () => Date;
    /** Catalog wins over intake and stored shoe. Omitted uses trusted shoe data. */
    catalog?: unknown;
    /** Authenticated VO payload. Null names do not invent a patient. */
    intake?: DogfoodOrderIntake | null;
}): Promise<DogfoodOrderAutoBindResult> {
    const verifier = args.verifier ?? unconfiguredOrderPersonVerifier;
    const now = (args.now ?? (() => new Date()))();
    const requestedId = args.externalOrderId.trim();
    const request = dogfoodOrderPersonRequest(requestedId);
    const accepted = acceptVerifiedOrderPerson(await verifier.verify(request), request, now);
    if (!accepted.ok) {
        if (accepted.code === "verifier_unconfigured") throw new DogfoodOrderAutoBindUnconfiguredError();
        requireDogfoodExternalOrderId(requestedId);
        throw dogfoodOrderIdentityRefusal(accepted.code);
    }
    const externalOrderId = requireDogfoodExternalOrderId(requestedId);
    if (!orderPersonStillFresh(accepted.person, now)) throw dogfoodOrderIdentityRefusal("verifier_stale");
    assertDogfoodNotHeld(accepted.person.externalPersonId);
    return bindAcceptedPerson(args, accepted.person, externalOrderId, now);
}

async function bindAcceptedPerson(
    args: {
        store: DogfoodSavedDesignStore;
        catalog?: unknown;
        intake?: DogfoodOrderIntake | null;
    },
    person: VerifiedOrderPerson,
    externalOrderId: string,
    now: Date,
): Promise<DogfoodOrderAutoBindResult> {
    if (!args.store.findPersonLinks || !args.store.establishVerifiedOrder) {
        throw dogfoodOrderIdentityRefusal("order_person_unbound");
    }
    const orders = await args.store.findOrderLinks(externalOrderId);
    const people = await args.store.findPersonLinks(person.externalPersonId);
    if (orders.length > 1 || people.length > 1) throw dogfoodOrderIdentityRefusal("order_client_ambiguous");
    const order = orders[0] ?? null;
    const existing = people[0] ?? null;
    if (order && (!existing || !sameId(order.clientId, existing.clientId))) {
        throw dogfoodOrderIdentityRefusal("order_client_mismatch");
    }
    if (order && existing) {
        const client = await args.store.findClient(order.clientId);
        if (!client || client.tenantId !== DOGFOOD_TENANT_ID) {
            throw dogfoodOrderIdentityRefusal("order_client_cross_tenant");
        }
        return {
            created: false,
            established: false,
            identity: "existing_order_binding",
            externalOrderId,
            clientId: client.id,
            designId: order.designId,
            createdClient: false,
            shoeWidth: null,
            shoeWidthSource: null,
        };
    }
    const givenName = existing?.givenName ?? person.givenName ?? intakeLabel(args.intake?.names?.givenName);
    const familyName =
        existing?.familyName ?? person.familyName ?? intakeLabel(args.intake?.names?.familyName);
    if (!existing && (!givenName || !familyName)) throw dogfoodOrderIdentityRefusal("verifier_incomplete");
    if (!orderPersonStillFresh(person, now)) throw dogfoodOrderIdentityRefusal("verifier_stale");
    const built = buildSavedDesignSnapshot({
        stored: null,
        catalog: parseSavedDesignCatalog(catalogForBind(args.catalog, args.intake, existing?.shoe)),
    });
    const linkShoeWidth = integrationLinkShoeWidth(built.shoeWidth, built.shoeWidthSource);
    const established = await commitVerified(args.store, {
        externalOrderId,
        externalPersonId: person.externalPersonId,
        givenName: givenName ?? "",
        familyName: familyName ?? "",
        verifiedAt: person.verifiedAt,
        now,
        settingsJson: envelopeFor(built.design),
        linkShoe: built.linkShoe,
        linkShoeWidth,
        chartWidth: linkShoeWidth,
    });
    if (established.outcome === "created" || established.outcome === "exists") {
        return {
            created: established.outcome === "created",
            established: established.outcome === "created",
            identity: established.outcome === "created" ? "verified_order_person" : "existing_order_binding",
            externalOrderId,
            clientId: established.clientId,
            designId: established.designId,
            createdClient: established.outcome === "created" ? established.createdClient : false,
            shoeWidth: linkShoeWidth,
            shoeWidthSource: built.shoeWidthSource,
        };
    }
    if (established.outcome === "ambiguous") throw dogfoodOrderIdentityRefusal("order_client_ambiguous");
    if (established.outcome === "stale") throw dogfoodOrderIdentityRefusal("verifier_stale");
    if (established.outcome === "no_owner") throw dogfoodOrderIdentityRefusal("order_person_unbound");
    throw dogfoodOrderIdentityRefusal("order_client_mismatch");
}

/** Runtime entry. Gate, origin, and bearer stay on the order-owner verifier. */
export async function runtimeAutoBindDogfoodOrder(input: {
    externalOrderId: string;
    intake: DogfoodOrderIntake | null;
    now?: () => Date;
}): Promise<DogfoodOrderAutoBindResult> {
    return autoBindDogfoodOrder({
        externalOrderId: input.externalOrderId,
        intake: input.intake,
        now: input.now,
        verifier: runtimeDogfoodOrderOwnerVerifier(process.env),
        store: lazyPrismaDogfoodSavedDesignStore(),
    });
}
