// Hosted MCP auth. Same credential as stdio: a caller-supplied CAD-operator integration key.
// Rules copied from the server so this package does not open a second scope list:
//   vertex/server/src/auth/cad-operator.ts:10 (dogfood tenant)
//   vertex/server/src/auth/cad-operator.ts:12-21 (scopes are not stored on the key)
//   vertex/server/src/auth/cad-operator.ts:43-64 (bearer, ocad_ prefix, principal)
//   vertex/server/src/auth/cad-operator.ts:77-82 (cadOperatorHasScope)
//   vertex/server/src/auth/integration-keys.ts:12-14 (sha256 key hash)
//   vertex/server/src/auth/integration-keys.ts:26-29 (redaction)
//   vertex/server/src/routers/integrations/service.ts:176-186 (unknown/revoked → 401)
// Tool → scope matches the tRPC procedure that the handler calls:
//   design.get — vertex/server/src/routers/design.ts:42 design:read
//   prepareManufacturingStlUpload — manufacturing.ts:198-202 manufacturing:prepare
//   generateSolid — manufacturing.ts:294-298 manufacturing:generate
//   persistSavedDesignSnapshot / createSavedDesign — manufacturing.ts:381-420 manufacturing:generate
//   getProduction / listProductionsByDesign / getGcodeDownloadUrl — manufacturing.ts:347-475 manufacturing:download
// Integration design reads are dogfood-only (service.ts:627-631). They map to design:read.

import { createHash } from "node:crypto";

import type { MCP_TOOL_DEFINITIONS } from "./tools/schemas.js";

/** Founder-locked dogfood tenant. Must match cad-operator.ts DOGFOOD_TENANT_ID. */
export const DOGFOOD_TENANT_ID = "54b6a960-aa40-4988-b116-adf5ed6c72f8";

/**
 * Logical CAD-operator capabilities. Not stored on the credential and not widened per key.
 * Must match CAD_OPERATOR_SCOPES in vertex/server/src/auth/cad-operator.ts.
 */
export const CAD_OPERATOR_SCOPES = [
    "design:read",
    "manufacturing:prepare",
    "manufacturing:generate",
    "manufacturing:download",
] as const;

export type CadOperatorScope = (typeof CAD_OPERATOR_SCOPES)[number];

export interface McpCredentialRow {
    id: string;
    revokedAt: string | null;
    tenantIds: readonly string[];
}

export interface McpCadOperatorPrincipal {
    kind: "cad_operator";
    credentialId: string;
    tenantId: typeof DOGFOOD_TENANT_ID;
    scopes: readonly CadOperatorScope[];
}

export type McpAuthDecision =
    | { ok: true; apiKey: string; principal: McpCadOperatorPrincipal }
    | { ok: false; status: 401 | 403; message: string };

const AUTH_REQUIRED = "Authentication required";
const INSUFFICIENT_SCOPE = "Insufficient scope";

/**
 * Scopes a tool needs before its handler runs.
 * Local payload tools do not call the API. They still require the full CAD-operator set
 * so a narrowed principal cannot use them. Stdio does not apply this gate.
 */
export const MCP_TOOL_REQUIRED_SCOPES = {
    get_design: ["design:read"],
    list_designs_by_order: ["design:read"],
    get_design_params: ["design:read"],
    prepare_manufacturing_stl_upload: ["manufacturing:prepare"],
    list_materials: ["manufacturing:generate"],
    generate_gcode: ["manufacturing:generate"],
    get_production: ["manufacturing:download"],
    list_productions_by_design: ["manufacturing:download"],
    get_export_download: ["manufacturing:download"],
    build_design_exported_payload: CAD_OPERATOR_SCOPES,
    persist_saved_design_snapshot: ["manufacturing:generate"],
    create_saved_design: ["manufacturing:generate"],
    prepare_vo_attachment: CAD_OPERATOR_SCOPES,
} as const satisfies Record<(typeof MCP_TOOL_DEFINITIONS)[number]["name"], readonly CadOperatorScope[]>;

export function hashCadOperatorKey(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/** Drop anything outside the locked CAD-operator set. Never grants a scope the caller lacks. */
export function lockCadOperatorScopes(scopes: readonly string[]): CadOperatorScope[] {
    return CAD_OPERATOR_SCOPES.filter((scope) => scopes.includes(scope));
}

export function redactSecrets(value: string): string {
    return value
        .replace(/Bearer\s+ocad_[A-Za-z0-9_-]+/g, "Bearer [redacted-key]")
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]{20,}(?:=*)/g, "Bearer [redacted-key]")
        .replace(/ocad_[A-Za-z0-9_-]+/g, "[redacted-key]")
        .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-db-url]");
}

/** Same bearer parse as cad-operator.ts bearerToken. Scheme match is case-sensitive, as on the server. */
export function bearerToken(authorization: string | undefined): string | null {
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = authorization.slice("Bearer ".length).trim();
    if (!token || /\s/.test(token)) return null;
    return token;
}

export function isCadOperatorKeyToken(token: string): boolean {
    return token.startsWith("ocad_");
}

export function principalFromCredential(row: McpCredentialRow): McpCadOperatorPrincipal | null {
    if (row.revokedAt) return null;
    if (!row.tenantIds.includes(DOGFOOD_TENANT_ID)) return null;
    return {
        kind: "cad_operator",
        credentialId: row.id,
        tenantId: DOGFOOD_TENANT_ID,
        scopes: CAD_OPERATOR_SCOPES,
    };
}

export function toolMissingScope(scopes: readonly string[], toolName: string): boolean {
    const required = MCP_TOOL_REQUIRED_SCOPES[toolName as keyof typeof MCP_TOOL_REQUIRED_SCOPES];
    if (!required) return false;
    const locked = lockCadOperatorScopes(scopes);
    return required.some((scope) => !locked.includes(scope));
}

export async function authorizeMcpBearer(
    authorization: string | undefined,
    findByHash: (hash: string) => Promise<McpCredentialRow | null>,
): Promise<McpAuthDecision> {
    const token = bearerToken(authorization);
    if (!token || !isCadOperatorKeyToken(token)) {
        return { ok: false, status: 401, message: AUTH_REQUIRED };
    }
    const row = await findByHash(hashCadOperatorKey(token));
    if (!row || row.revokedAt) {
        return { ok: false, status: 401, message: AUTH_REQUIRED };
    }
    const principal = principalFromCredential(row);
    if (!principal) {
        return { ok: false, status: 403, message: INSUFFICIENT_SCOPE };
    }
    return { ok: true, apiKey: token, principal };
}

export const MCP_AUTH_MESSAGES = {
    required: AUTH_REQUIRED,
    insufficientScope: INSUFFICIENT_SCOPE,
} as const;
