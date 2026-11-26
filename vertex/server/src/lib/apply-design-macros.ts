// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Applies the same correction macros as the Corrections panel Merge button
// onto one saved design. Does not rebuild from a catalog and does not loft.
// The apply implementation is the clinical module, loaded from the Node bundle
// so the Vercel function does not have to resolve `@/`.

import type { Prisma, PrismaClient } from "@prisma/client";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import type { CadOperatorPrincipal } from "../auth/cad-operator.js";
import { dogfoodDesignRead } from "../auth/dogfood-design-access.js";
import type { BundledDesignMacro, BundledDesignMacroSelection } from "./design-macros.bundled.js";
import { settingsEnvelopeForSave } from "./design-schema.js";

export interface ListedDesignMacro {
    id: string;
    name: string;
    kind: "customer" | "pathology";
    description: string | null;
    aliases: string[];
}

export interface ApplyDesignMacrosResult {
    ok: true;
    design_id: string;
    changed: boolean;
    applied: Array<{ id: string; name: string; kind: "customer" | "pathology" }>;
    settingsJson: unknown;
}

export interface DesignMacroRuntime {
    listDesignMacros(extraCustomer?: readonly BundledDesignMacro[]): BundledDesignMacro[];
    resolveDesignMacros(
        selection: BundledDesignMacroSelection,
        macros?: readonly BundledDesignMacro[],
    ): BundledDesignMacro[];
    applyDesignMacrosToDesign(
        design: Record<string, unknown>,
        selection: BundledDesignMacroSelection,
        macros?: readonly BundledDesignMacro[],
    ): Record<string, unknown>;
    DesignMacroError: new (message: string) => Error;
}

interface MacroDesignRow {
    id: string;
    ownerId: string;
    name: string;
    kind: string;
    pattern: string;
    method: string;
    thicknessMm: number;
    linked: boolean;
    unit: string;
    settingsJson: unknown;
    updatedAt: Date | string;
    deletedAt: Date | string | null;
    client: { tenantId: string | null } | null;
    integrationLink: {
        tenantId: string;
        source: string;
        externalOrderId: string;
        sides: string;
    } | null;
}

interface AppliedDesign {
    thicknessMm: number;
    corrections: { linked: boolean };
}

let runtimePromise: Promise<DesignMacroRuntime> | null = null;

/** Production loader. Tests pass `runtime` and do not need the generated file. */
export function loadDesignMacroRuntime(): Promise<DesignMacroRuntime> {
    if (!runtimePromise) {
        runtimePromise = import("./design-macros.bundled.js").then((mod) => mod as DesignMacroRuntime);
    }
    return runtimePromise;
}

/** Names and lookup aliases. Payloads stay on the server so a caller cannot send millimetres. */
export async function listDesignMacrosForOperator(
    extraCustomer: readonly BundledDesignMacro[] = [],
    runtime?: DesignMacroRuntime,
): Promise<{ macros: ListedDesignMacro[] }> {
    const macros = (runtime ?? (await loadDesignMacroRuntime())).listDesignMacros(extraCustomer);
    return {
        macros: macros.map((macro) => ({
            id: macro.id,
            name: macro.name,
            kind: macro.kind,
            description: macro.description ?? null,
            aliases: [...(macro.aliases ?? [])],
        })),
    };
}

function stableJson(value: unknown): string {
    if (value === undefined) return "null";
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function assertSavedCorrections(
    settings: Record<string, unknown>,
    DesignMacroError: new (message: string) => Error,
): Record<string, unknown> {
    const corrections = settings.corrections;
    if (!corrections || typeof corrections !== "object") {
        throw new DesignMacroError("Saved design has no corrections. Refusing to guess a clinical value.");
    }
    return settings;
}

/**
 * Merge customer then pathology onto the stored settings and write that
 * settingsJson. Omit both names and the row is not updated.
 * `macros` is a test seam. Production uses the bundled library.
 */
export async function applyDesignMacrosOnDesign(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal;
    designId: string;
    customerMacro?: string;
    pathologyMacro?: string;
    macros?: readonly BundledDesignMacro[];
    /** Test seam. Production loads design-macros.bundled.js. */
    runtime?: DesignMacroRuntime;
}): Promise<ApplyDesignMacrosResult> {
    const runtime = args.runtime ?? (await loadDesignMacroRuntime());
    const row = (await args.prisma.design.findUnique({
        where: { id: args.designId },
        select: {
            id: true,
            ownerId: true,
            name: true,
            kind: true,
            pattern: true,
            method: true,
            thicknessMm: true,
            linked: true,
            unit: true,
            settingsJson: true,
            updatedAt: true,
            deletedAt: true,
            client: { select: { tenantId: true } },
            integrationLink: {
                select: {
                    tenantId: true,
                    source: true,
                    externalOrderId: true,
                    sides: true,
                },
            },
        },
    })) as MacroDesignRow | null;

    const design = dogfoodDesignRead(
        args.principal,
        row
            ? {
                  id: row.id,
                  ownerId: row.ownerId,
                  name: row.name,
                  kind: row.kind,
                  pattern: row.pattern,
                  method: row.method,
                  thicknessMm: row.thicknessMm,
                  linked: row.linked,
                  unit: row.unit,
                  settingsJson: row.settingsJson,
                  updatedAt: row.updatedAt,
                  deletedAt: row.deletedAt,
                  clientTenantId: row.client?.tenantId ?? null,
                  linkTenantId: row.integrationLink?.tenantId ?? null,
                  source: row.integrationLink?.source ?? null,
                  externalOrderId: row.integrationLink?.externalOrderId ?? null,
                  sides: row.integrationLink?.sides ?? null,
              }
            : null,
    );

    let applied: BundledDesignMacro[];
    try {
        applied = runtime.resolveDesignMacros(
            { customer: args.customerMacro, pathology: args.pathologyMacro },
            args.macros,
        );
    } catch (error) {
        if (error instanceof runtime.DesignMacroError) throw error;
        throw error;
    }

    const appliedPublic = applied.map((macro) => ({
        id: macro.id,
        name: macro.name,
        kind: macro.kind,
    }));

    if (!row || applied.length === 0) {
        return {
            ok: true,
            design_id: design.id,
            changed: false,
            applied: appliedPublic,
            settingsJson: row?.settingsJson ?? null,
        };
    }

    if (row.kind === "afo") {
        throw new runtime.DesignMacroError("AFO designs are not an insole correction macro.");
    }

    const settings = readStoredDesignSettings(row.settingsJson);
    if (!settings) {
        throw new runtime.DesignMacroError(
            "This design has no saved settings. Refusing to apply a macro onto an empty design.",
        );
    }

    let next: Record<string, unknown>;
    try {
        next = runtime.applyDesignMacrosToDesign(
            assertSavedCorrections(settings, runtime.DesignMacroError),
            { customer: args.customerMacro, pathology: args.pathologyMacro },
            args.macros,
        );
    } catch (error) {
        if (error instanceof runtime.DesignMacroError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new runtime.DesignMacroError(
            `macro was not applied (${message}). Refusing to guess a clinical value.`,
        );
    }

    let settingsJson: unknown;
    try {
        settingsJson = settingsEnvelopeForSave(next);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new runtime.DesignMacroError(`saved design is not writable (${message}). Refusing to write.`);
    }

    const nextSettings = readStoredDesignSettings(settingsJson);
    if (stableJson(settings) === stableJson(nextSettings)) {
        return {
            ok: true,
            design_id: design.id,
            changed: false,
            applied: appliedPublic,
            settingsJson: row.settingsJson,
        };
    }

    const appliedDesign = next as unknown as AppliedDesign;
    const updateData: {
        settingsJson: Prisma.InputJsonValue;
        thicknessMm?: number;
        linked?: boolean;
    } = {
        settingsJson: settingsJson as Prisma.InputJsonValue,
    };
    if (appliedDesign.thicknessMm !== row.thicknessMm) updateData.thicknessMm = appliedDesign.thicknessMm;
    if (appliedDesign.corrections.linked !== row.linked) updateData.linked = appliedDesign.corrections.linked;

    await args.prisma.design.update({
        where: { id: design.id },
        data: updateData,
    });

    return {
        ok: true,
        design_id: design.id,
        changed: true,
        applied: appliedPublic,
        settingsJson,
    };
}
