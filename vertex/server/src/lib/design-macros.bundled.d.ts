// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Type stub for the generated Node ESM bundle. The .js file is emitted by
// scripts/bundle-design-macros.mjs and is not source.

export type BundledDesignMacroKind = "customer" | "pathology";

export interface BundledDesignMacro {
    id: string;
    name: string;
    kind: BundledDesignMacroKind;
    description?: string;
    aliases?: readonly string[];
    payload: unknown;
}

export interface BundledDesignMacroSelection {
    customer?: string | null;
    pathology?: string | null;
}

export class DesignMacroError extends Error {}

export function listDesignMacros(extraCustomer?: readonly BundledDesignMacro[]): BundledDesignMacro[];

export function resolveDesignMacros(
    selection: BundledDesignMacroSelection,
    macros?: readonly BundledDesignMacro[],
): BundledDesignMacro[];

export function applyDesignMacrosToDesign(
    design: Record<string, unknown>,
    selection: BundledDesignMacroSelection,
    macros?: readonly BundledDesignMacro[],
): Record<string, unknown>;
