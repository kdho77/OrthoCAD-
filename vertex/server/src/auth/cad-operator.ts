// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Dogfood-only CAD-operator Bearer. This is not a session user and not a tRPC-wide bypass.

import { randomUUID } from "node:crypto";

import { MANUFACTURING_TEMP_PREFIX } from "../lib/storage.js";
import { hashIntegrationKey } from "./integration-keys.js";

/** Founder-locked dogfood tenant. CAD-operator tRPC does not authorize any other tenant. */
export const DOGFOOD_TENANT_ID = "54b6a960-aa40-4988-b116-adf5ed6c72f8";

/**
 * Logical capabilities for the dogfood CAD-operator path.
 * These are not stored on the credential and cannot be widened per key.
 */
export const CAD_OPERATOR_SCOPES = [
    "design:read",
    "manufacturing:prepare",
    "manufacturing:generate",
    "manufacturing:download",
] as const;

export type CadOperatorScope = (typeof CAD_OPERATOR_SCOPES)[number];

/** Locked Apex Core belt slice. Must match the Export material table. */
export const CAD_OPERATOR_BELT_PROFILE_ID = "apex-v2-insole-95a";
export const CAD_OPERATOR_BELT_MATERIAL = "apex_core";
export const CAD_OPERATOR_BELT_ANGLE_DEG = 45;

/** Production row preset for the central-fab solid. Not a slicer profile. */
export const CENTRAL_FAB_STL_PRESET_ID = "central-fab-stl";

export interface CadOperatorCredentialRow {
    id: string;
    revokedAt: string | null;
    tenantIds: readonly string[];
}

export interface CadOperatorPrincipal {
    kind: "cad_operator";
    credentialId: string;
    tenantId: typeof DOGFOOD_TENANT_ID;
    scopes: readonly CadOperatorScope[];
}

export function bearerToken(authorization: string | undefined): string | null {
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = authorization.slice("Bearer ".length).trim();
    if (!token || /\s/.test(token)) return null;
    return token;
}

export function isCadOperatorKeyToken(token: string): boolean {
    return token.startsWith("ocad_");
}

/** Dogfood membership only. Other tenants on the same key do not become CAD tenants. */
export function principalFromCredential(row: CadOperatorCredentialRow): CadOperatorPrincipal | null {
    if (row.revokedAt) return null;
    if (!row.tenantIds.includes(DOGFOOD_TENANT_ID)) return null;
    return {
        kind: "cad_operator",
        credentialId: row.id,
        tenantId: DOGFOOD_TENANT_ID,
        scopes: CAD_OPERATOR_SCOPES,
    };
}

export async function resolveCadOperatorFromAuthorization(
    authorization: string | undefined,
    findByHash: (hash: string) => Promise<CadOperatorCredentialRow | null>,
): Promise<CadOperatorPrincipal | null> {
    const token = bearerToken(authorization);
    if (!token || !isCadOperatorKeyToken(token)) return null;
    const row = await findByHash(hashIntegrationKey(token));
    if (!row) return null;
    return principalFromCredential(row);
}

export function cadOperatorHasScope(
    principal: CadOperatorPrincipal | null | undefined,
    scope: CadOperatorScope,
): principal is CadOperatorPrincipal {
    return Boolean(principal && principal.tenantId === DOGFOOD_TENANT_ID && principal.scopes.includes(scope));
}

export function cadOperatorTempPrefix(credentialId: string): string {
    return `${MANUFACTURING_TEMP_PREFIX}cad-operator/${DOGFOOD_TENANT_ID}/${credentialId}/`;
}

export function buildCadOperatorTempStlKey(
    credentialId: string,
    stamp = Date.now(),
    id = randomUUID(),
): string {
    return `${cadOperatorTempPrefix(credentialId)}${stamp}-${id}.stl`;
}

/** Fail closed. The rejected key is not included in the message. */
export function assertCadOperatorTempStlKey(key: string, credentialId: string): void {
    const prefix = cadOperatorTempPrefix(credentialId);
    if (!key.startsWith(prefix) || !key.endsWith(".stl") || key.includes("..")) {
        throw new Error("Invalid manufacturing STL storage key");
    }
}

export function cadOperatorGcodePrefix(credentialId: string): string {
    return `gcode/cad-operator/${DOGFOOD_TENANT_ID}/${credentialId}/`;
}

export function buildCadOperatorGcodeKey(credentialId: string, designId: string, fileName: string): string {
    return `${cadOperatorGcodePrefix(credentialId)}${designId}/${fileName}`;
}

export function assertCadOperatorGcodeKey(key: string, credentialId: string): void {
    const prefix = cadOperatorGcodePrefix(credentialId);
    if (!key.startsWith(prefix) || key.includes("..")) {
        throw new Error("Invalid G-code storage key");
    }
}

export function cadOperatorCentralFabStlPrefix(credentialId: string): string {
    return `stl/cad-operator/${DOGFOOD_TENANT_ID}/${credentialId}/`;
}

/** Durable milling solid. Not under manufacturing-temp, so the TTL job does not delete it. */
export function buildCadOperatorCentralFabStlKey(
    credentialId: string,
    designId: string,
    side: "left" | "right",
    stamp = Date.now(),
    id = randomUUID(),
): string {
    return `${cadOperatorCentralFabStlPrefix(credentialId)}${designId}/${side}-${stamp}-${id}.stl`;
}

export function assertCadOperatorCentralFabStlKey(key: string, credentialId: string): void {
    const prefix = cadOperatorCentralFabStlPrefix(credentialId);
    if (!key.startsWith(prefix) || !key.endsWith(".stl") || key.includes("..")) {
        throw new Error("Invalid central-fab STL storage key");
    }
}

/** G-code keys stay on their prefix. Central-fab STL keys are a second prefix for the same credential. */
export function assertCadOperatorDeliverableKey(key: string, credentialId: string): void {
    try {
        assertCadOperatorGcodeKey(key, credentialId);
        return;
    } catch {
        assertCadOperatorCentralFabStlKey(key, credentialId);
    }
}
