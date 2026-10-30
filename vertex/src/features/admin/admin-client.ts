// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { isApiConfigured, trpc } from "@/lib/trpc";
import {
    type AdminAuditEntry,
    applyLedgerWrite,
    type BillingTerm,
    buildAuditEntry,
    computeLicenseExpiry,
    DEMO_TENANTS,
    demoUsersForTenant,
    extendExpiry,
    generateTempPassword,
    isValidAdminEmail,
    slugifyTenantName,
    type TenantAdminInvite,
    type TenantPlan,
    type TenantRecord,
    type TenantStatus,
    type TenantUserAccount,
    type TokenLedgerEntry,
} from "../../../shared/admin/admin-domain";

export const TENANT_MIGRATION_NOTICE =
    "Tenant tables are not migrated. Showing demo tenants. Apply vertex/prisma/migrations/20261015120000_super_admin_tenants/migration.sql in the Supabase SQL editor.";

let demoTenants: TenantRecord[] = structuredClone(DEMO_TENANTS);
const demoLedger = new Map<string, TokenLedgerEntry[]>();
const demoUsers = new Map<string, TenantUserAccount[]>(
    DEMO_TENANTS.map((tenant) => [tenant.id, demoUsersForTenant(tenant)]),
);
const demoAudit: AdminAuditEntry[] = [];
let demoBecauseUnmigrated = false;

export function resetAdminDemoFallback(): void {
    demoBecauseUnmigrated = false;
}

export function adminDemoNotice(): string | null {
    if (!isApiConfigured()) return null;
    return demoBecauseUnmigrated ? TENANT_MIGRATION_NOTICE : null;
}

export function isMissingTenantMigration(error: unknown): boolean {
    const message = surfaceAdminError(error, "");
    const record =
        error && typeof error === "object"
            ? (error as { data?: { code?: string }; shape?: { data?: { code?: string } } })
            : null;
    const code = record?.data?.code ?? record?.shape?.data?.code ?? "";
    return /not migrated/i.test(message) || code === "PRECONDITION_FAILED";
}

async function liveOrDemo<T>(live: () => Promise<T>, demo: () => T | Promise<T>): Promise<T> {
    if (!isApiConfigured() || demoBecauseUnmigrated) return await demo();
    try {
        return await live();
    } catch (error) {
        if (isMissingTenantMigration(error)) {
            demoBecauseUnmigrated = true;
            return await demo();
        }
        throw error;
    }
}

function bumpDemo(tenant: TenantRecord, patch: Partial<TenantRecord>): TenantRecord {
    const next = { ...tenant, ...patch, updatedAt: new Date().toISOString() };
    demoTenants = demoTenants.map((t) => (t.id === tenant.id ? next : t));
    return next;
}

function pushDemoAudit(input: Parameters<typeof buildAuditEntry>[0] & { tenantName?: string | null }) {
    const entry = buildAuditEntry(input);
    demoAudit.unshift({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        actorEmail: "kdho@vertexorthopedic.com",
        tenantName: input.tenantName ?? null,
        ...entry,
    });
}

export async function fetchTenants(): Promise<TenantRecord[]> {
    return liveOrDemo(
        () => trpc.admin.tenants.list.query(),
        () => demoTenants.filter((t) => !t.archivedAt),
    );
}

function demoTenantDetail(id: string) {
    const tenant = demoTenants.find((t) => t.id === id);
    if (!tenant) throw new Error("Tenant not found");
    return {
        tenant,
        ledger: demoLedger.get(id) ?? [],
        audit: demoAudit.filter((a) => a.tenantId === id),
        users: demoUsers.get(id) ?? [],
    };
}

export async function fetchTenant(id: string) {
    return liveOrDemo(
        () => trpc.admin.tenants.get.query({ id }),
        () => demoTenantDetail(id),
    );
}

export async function fetchAudit(filters?: {
    tenantId?: string;
    action?: string;
    from?: string;
    to?: string;
}): Promise<AdminAuditEntry[]> {
    return liveOrDemo(
        () => trpc.admin.tenantAudit.list.query(filters),
        () =>
            demoAudit.filter((row) => {
                if (filters?.tenantId && row.tenantId !== filters.tenantId) return false;
                if (filters?.action && row.action !== filters.action) return false;
                if (filters?.from && row.createdAt < filters.from) return false;
                if (filters?.to && row.createdAt > filters.to) return false;
                return true;
            }),
    );
}

export async function fetchAuditCsv(filters?: {
    tenantId?: string;
    action?: string;
    from?: string;
    to?: string;
}): Promise<string> {
    return liveOrDemo(
        () => trpc.admin.tenantAudit.csv.query(filters),
        async () => {
            const { auditRowsToCsv } = await import("../../../shared/admin/admin-domain");
            return auditRowsToCsv(await fetchAudit(filters));
        },
    );
}

export async function createTenant(input: {
    name: string;
    plan: TenantPlan;
    seats: number;
    status: "active" | "trial";
    billingTerm: BillingTerm;
    adminName: string;
    adminEmail: string;
    expiresAt?: string | null;
    initialTokens?: number;
    reason: string;
}): Promise<{ tenant: TenantRecord; admin: TenantAdminInvite }> {
    if (!input.adminName.trim()) throw new Error("Admin name is required");
    if (!isValidAdminEmail(input.adminEmail)) throw new Error("A valid admin email is required");
    return liveOrDemo(
        () => trpc.admin.tenants.create.mutate(input),
        async () => {
            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const billingTerm: BillingTerm = input.billingTerm === "annual" ? "annual" : "monthly";
            const expiresAt = input.expiresAt ?? computeLicenseExpiry(now, input.status, billingTerm);
            const tenant: TenantRecord = {
                id,
                name: input.name.trim(),
                slug: `${slugifyTenantName(input.name)}-${id.slice(0, 8)}`,
                status: input.status,
                plan: input.plan,
                seats: input.seats,
                seatsUsed: 1,
                billingTerm,
                startsAt: now,
                expiresAt,
                tokenBalance: 0,
                tokenThreshold: 50,
                lastActivityAt: null,
                archivedAt: null,
                createdAt: now,
                updatedAt: now,
            };
            demoTenants = [tenant, ...demoTenants];
            const admin: TenantAdminInvite = {
                id: crypto.randomUUID(),
                fullName: input.adminName.trim(),
                email: input.adminEmail.trim().toLowerCase(),
                role: "admin",
                lastLoginAt: null,
                tempPassword: generateTempPassword(),
                inviteLink: `https://app.vertexorthopedic.com/invite?tenant=${id}`,
            };
            demoUsers.set(id, [admin]);
            if (input.initialTokens) {
                await grantTokens({ tenantId: id, amount: input.initialTokens, reason: input.reason });
                const afterGrant = demoTenants.find((row) => row.id === id);
                if (afterGrant) bumpDemo(afterGrant, { lastActivityAt: null, seatsUsed: 1 });
            } else {
                pushDemoAudit({
                    action: "tenant.created",
                    reason: input.reason,
                    tenantId: id,
                    tenantName: tenant.name,
                    after: { tenant, adminEmail: admin.email },
                });
            }
            return { tenant: demoTenants.find((row) => row.id === id) ?? tenant, admin };
        },
    );
}

export async function updateLicense(input: {
    tenantId: string;
    plan: TenantPlan;
    seats: number;
    billingTerm: BillingTerm;
    startsAt: string;
    expiresAt: string | null;
    status: Exclude<TenantStatus, "archived">;
    reason: string;
}): Promise<TenantRecord> {
    return liveOrDemo(
        () => trpc.admin.tenants.updateLicense.mutate(input),
        () => {
            const before = demoTenants.find((t) => t.id === input.tenantId);
            if (!before) throw new Error("Tenant not found");
            const after = bumpDemo(before, {
                plan: input.plan,
                seats: input.seats,
                billingTerm: input.billingTerm,
                startsAt: input.startsAt,
                expiresAt: input.expiresAt,
                status: input.status,
            });
            pushDemoAudit({
                action: "tenant.license_updated",
                reason: input.reason,
                tenantId: input.tenantId,
                tenantName: after.name,
                before,
                after,
            });
            return after;
        },
    );
}

export async function extendTenant(input: {
    tenantId: string;
    days?: number;
    expiresAt?: string;
    reason: string;
}): Promise<{ tenant: TenantRecord; from: string | null; to: string }> {
    return liveOrDemo(
        () => trpc.admin.tenants.extend.mutate(input),
        () => {
            const before = demoTenants.find((t) => t.id === input.tenantId);
            if (!before) throw new Error("Tenant not found");
            const to = input.expiresAt ?? extendExpiry(before.expiresAt, input.days ?? 30);
            const after = bumpDemo(before, {
                expiresAt: to,
                status: before.status === "expired" ? "active" : before.status,
                lastActivityAt: new Date().toISOString(),
            });
            pushDemoAudit({
                action: "tenant.extended",
                reason: input.reason,
                tenantId: input.tenantId,
                tenantName: after.name,
                before: { expiresAt: before.expiresAt },
                after: { expiresAt: to },
            });
            return { tenant: after, from: before.expiresAt, to };
        },
    );
}

export async function grantTokens(input: {
    tenantId: string;
    amount: number;
    reason: string;
    note?: string;
    expiresAt?: string | null;
}): Promise<{ tenant: TenantRecord; from: number; to: number }> {
    return liveOrDemo(
        () => trpc.admin.tenants.grantTokens.mutate(input),
        () => {
            const before = demoTenants.find((t) => t.id === input.tenantId);
            if (!before) throw new Error("Tenant not found");
            const existing = demoLedger.get(input.tenantId) ?? [];
            const applied = applyLedgerWrite(existing, {
                type: input.amount < 0 ? "adjustment" : "grant",
                amount: input.amount,
                reason: input.reason,
                note: input.note,
                expiresAt: input.expiresAt,
            });
            const entry: TokenLedgerEntry = {
                id: crypto.randomUUID(),
                tenantId: input.tenantId,
                type: applied.type,
                amount: applied.amount,
                balanceAfter: applied.balanceAfter,
                actorId: null,
                actorEmail: "offline",
                reason: applied.reason,
                note: input.note ?? null,
                expiresAt: input.expiresAt ?? null,
                createdAt: new Date().toISOString(),
            };
            demoLedger.set(input.tenantId, [...existing, entry]);
            const after = bumpDemo(before, {
                tokenBalance: applied.balanceAfter,
                lastActivityAt: entry.createdAt,
            });
            pushDemoAudit({
                action: "tenant.grant_tokens",
                reason: input.reason,
                tenantId: input.tenantId,
                tenantName: after.name,
                before: { tokenBalance: before.tokenBalance },
                after: { tokenBalance: after.tokenBalance },
            });
            return { tenant: after, from: before.tokenBalance, to: after.tokenBalance };
        },
    );
}

export async function suspendTenant(input: {
    tenantId: string;
    reason: string;
    confirmName: string;
}): Promise<TenantRecord> {
    return liveOrDemo(
        () => trpc.admin.tenants.suspend.mutate(input),
        () => {
            const before = demoTenants.find((t) => t.id === input.tenantId);
            if (!before) throw new Error("Tenant not found");
            if (input.confirmName.trim() !== before.name) {
                throw new Error(`Type the tenant name "${before.name}" to confirm suspend`);
            }
            const after = bumpDemo(before, { status: "suspended", lastActivityAt: new Date().toISOString() });
            pushDemoAudit({
                action: "tenant.suspended",
                reason: input.reason,
                tenantId: input.tenantId,
                tenantName: after.name,
                before: { status: before.status },
                after: { status: after.status },
            });
            return after;
        },
    );
}

export async function reactivateTenant(input: { tenantId: string; reason: string }): Promise<TenantRecord> {
    return liveOrDemo(
        () => trpc.admin.tenants.reactivate.mutate(input),
        () => {
            const before = demoTenants.find((t) => t.id === input.tenantId);
            if (!before) throw new Error("Tenant not found");
            const after = bumpDemo(before, { status: "active", lastActivityAt: new Date().toISOString() });
            pushDemoAudit({
                action: "tenant.reactivated",
                reason: input.reason,
                tenantId: input.tenantId,
                tenantName: after.name,
                before: { status: before.status },
                after: { status: after.status },
            });
            return after;
        },
    );
}

export async function undoGrant(input: { tenantId: string; amount: number }) {
    return liveOrDemo(
        () => trpc.admin.tenants.undoGrant.mutate(input),
        () =>
            grantTokens({
                tenantId: input.tenantId,
                amount: -input.amount,
                reason: "Undo grant",
                note: "Reversal within undo window",
            }),
    );
}

export function surfaceAdminError(e: unknown, fallback: string): string {
    if (e instanceof Error && e.message) return e.message;
    return fallback;
}
