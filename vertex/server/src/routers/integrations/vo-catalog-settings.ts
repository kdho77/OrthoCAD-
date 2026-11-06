// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Maps VertexOrders connector catalog fields onto designs.settingsJson.
// A value is written only when this request carried it and DesignState has that setting.
// Missing, null, EU, and unrecognized keys are left out. rx_text is never parsed.

import { type DesignSettingsEnvelope, designSettingsEnvelope } from "../../../../shared/design-settings.js";
import type { ShoeSystem, ShoeWidth } from "./store.js";

/** Men's half-steps DesignState actually stores. Out-of-range values are omitted, not clamped. */
const US_MEN_MIN = 1;
const US_MEN_MAX = 16;

export class VoCatalogConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VoCatalogConflictError";
    }
}

export interface VoShoeSize {
    system: ShoeSystem;
    size: number;
}

/** Explicit order fields. Null means the request did not include that value. */
export interface VoOrderCatalogInput {
    shoeSize: VoShoeSize | null;
    shoeSizeLeft: number | null;
    shoeSizeRight: number | null;
    width: ShoeWidth | null;
    /** Structured `catalog` object from POST /api/integrations/v1/designs. Unknown keys are ignored. */
    catalog: unknown;
}

export interface ResolvedVoOrderCatalog {
    shoeSize: VoShoeSize | null;
    shoeSizeLeft: number | null;
    shoeSizeRight: number | null;
    /** Set only when the order named a width. Never the link-row medium default. */
    width: ShoeWidth | null;
}

/**
 * Connector keys that have a DesignState path.
 * US women's size uses the documented retail offset (women = men + 1.5) from shoe-size.ts.
 */
export const MAPPED_VO_KEYS = [
    {
        voKey: "shoe_size.system=US_M + shoe_size.size",
        settingsPath: "settings.sizeSystem, settings.usMenSize",
        rule: "Written when size is already a men's half-step from 1 to 16. Not rounded or clamped.",
    },
    {
        voKey: "shoe_size.system=US_W + shoe_size.size",
        settingsPath: "settings.sizeSystem, settings.usMenSize",
        rule: "usMenSize = size - 1.5 (inverse of usWomenFromMen). Omitted when that men's size is not a half-step from 1 to 16.",
    },
    {
        voKey: "width",
        settingsPath: "settings.shoeWidth",
        rule: "narrow, medium, or wide, only when the order includes width.",
    },
    {
        voKey: "catalog.shoe_size / catalog.shoe_size_left / catalog.shoe_size_right / catalog.width",
        settingsPath: "same paths as the top-level keys",
        rule: "Same rules. A conflict with the top-level value is rejected. Null does not invent a value.",
    },
] as const;

/**
 * Fields observed on the create-design connector that are not written into settingsJson.
 * kdho77/VertexOrders2-0 returned 404 to this token, so no further catalog keys were verified.
 */
export const UNMAPPED_VO_FIELDS = [
    {
        key: "source, tenant_id, client_id, external_order_id",
        reason: "Identity and tenancy. Not design parameters.",
    },
    {
        key: "type",
        reason: "Stored on designs.kind. DesignState has no device-kind field inside settingsJson.",
    },
    {
        key: "sides, scans.side",
        reason: "Stored on the integration link and scan upload. DesignState has no order-side field.",
    },
    {
        key: "rx_text",
        reason: "Kept on integration_designs.rxText. Free text is not parsed into numbers.",
    },
    {
        key: "notes, order_reference, ordered_by_account, parent_external_order_id",
        reason: "Link or note columns. Not parametric settings.",
    },
    {
        key: "shoe_size.system=EU",
        reason: "DesignState size systems are us, uk, and mm. No EU conversion is defined, so the size is omitted.",
    },
    {
        key: "shoe_size_left, shoe_size_right",
        reason: "DesignState has one footprint size. Differing left and right lengths are omitted instead of picking one.",
    },
    {
        key: "material, arch, length, shoe type, hardness, corrections, elements",
        reason: "Not on the verified connector payload. Not copied from catalog even if a caller sends them.",
    },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameShoe(a: VoShoeSize, b: VoShoeSize): boolean {
    return a.system === b.system && Math.abs(a.size - b.size) < 1e-6;
}

function pickValue<T>(
    top: T | null,
    catalog: T | null,
    same: (a: T, b: T) => boolean,
    label: string,
): T | null {
    if (top != null && catalog != null && !same(top, catalog)) {
        throw new VoCatalogConflictError(`${label} conflicts between the order and catalog`);
    }
    return catalog ?? top;
}

function readShoe(value: unknown): VoShoeSize | null {
    if (value == null) return null;
    if (!isRecord(value)) throw new VoCatalogConflictError("catalog.shoe_size must be { system, size }");
    const system = value.system;
    const size = value.size;
    if (system !== "US_M" && system !== "US_W" && system !== "EU") {
        throw new VoCatalogConflictError("catalog.shoe_size.system must be US_M, US_W, or EU");
    }
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
        throw new VoCatalogConflictError("catalog.shoe_size.size must be a positive number");
    }
    return { system, size };
}

function readOptionalNumber(value: unknown, label: string): number | null {
    if (value == null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new VoCatalogConflictError(`${label} must be a positive number`);
    }
    return value;
}

function readWidth(value: unknown): ShoeWidth | null {
    if (value == null) return null;
    if (value === "narrow" || value === "medium" || value === "wide") return value;
    throw new VoCatalogConflictError("catalog.width must be narrow, medium, or wide");
}

function catalogField(catalog: Record<string, unknown>, key: string): unknown {
    return Object.hasOwn(catalog, key) ? catalog[key] : null;
}

/** Top-level fields win only when catalog omits them. Disagreement is an error. */
export function resolveVoOrderCatalog(input: VoOrderCatalogInput): ResolvedVoOrderCatalog {
    const catalog = input.catalog == null ? null : input.catalog;
    if (catalog != null && !isRecord(catalog)) {
        throw new VoCatalogConflictError("catalog must be an object");
    }
    const record = catalog ?? {};
    return {
        shoeSize: pickValue(
            input.shoeSize,
            readShoe(catalogField(record, "shoe_size")),
            sameShoe,
            "shoe_size",
        ),
        shoeSizeLeft: pickValue(
            input.shoeSizeLeft,
            readOptionalNumber(catalogField(record, "shoe_size_left"), "catalog.shoe_size_left"),
            (a, b) => Math.abs(a - b) < 1e-6,
            "shoe_size_left",
        ),
        shoeSizeRight: pickValue(
            input.shoeSizeRight,
            readOptionalNumber(catalogField(record, "shoe_size_right"), "catalog.shoe_size_right"),
            (a, b) => Math.abs(a - b) < 1e-6,
            "shoe_size_right",
        ),
        width: pickValue(input.width, readWidth(catalogField(record, "width")), (a, b) => a === b, "width"),
    };
}

function isRepresentableUsMen(size: number): boolean {
    if (!Number.isFinite(size)) return false;
    const doubled = size * 2;
    if (Math.abs(doubled - Math.round(doubled)) > 1e-6) return false;
    return size >= US_MEN_MIN - 1e-9 && size <= US_MEN_MAX + 1e-9;
}

/**
 * Men's size for a provided shoe, or null when DesignState cannot store it.
 * Does not round, clamp, or substitute Men's 9.
 */
export function usMenSizeFromVoShoe(system: ShoeSystem, size: number): number | null {
    if (system === "EU") return null;
    const men = system === "US_W" ? size - 1.5 : size;
    return isRepresentableUsMen(men) ? men : null;
}

/** Parametric settings for this order. Empty when nothing mappable was present. */
export function mapVoCatalogToSettings(input: VoOrderCatalogInput): Record<string, unknown> | null {
    const resolved = resolveVoOrderCatalog(input);
    const settings: Record<string, unknown> = {};
    const left = resolved.shoeSizeLeft;
    const right = resolved.shoeSizeRight;
    const lengthsDisagree = left != null && right != null && Math.abs(left - right) >= 1e-6;
    const oneSidedLength = (left == null) !== (right == null);
    if (!lengthsDisagree && !oneSidedLength && resolved.shoeSize) {
        const size = left != null && right != null ? left : resolved.shoeSize.size;
        const men = usMenSizeFromVoShoe(resolved.shoeSize.system, size);
        if (men != null) {
            settings.sizeSystem = "us";
            settings.usMenSize = men;
        }
    }
    if (resolved.width) settings.shoeWidth = resolved.width;
    return Object.keys(settings).length > 0 ? settings : null;
}

export function settingsEnvelopeForVoCatalog(input: VoOrderCatalogInput): DesignSettingsEnvelope | null {
    const settings = mapVoCatalogToSettings(input);
    if (!settings) return null;
    return designSettingsEnvelope(settings);
}
