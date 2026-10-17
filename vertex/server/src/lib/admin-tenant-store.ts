// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import {
    type AdminAuditEntry,
    applyLedgerWrite,
    auditRowsToCsv,
    type BillingTerm,
    buildAuditEntry,
    computeLicenseExpiry,
    displayTenantStatus,
    extendExpiry,
    generateTempPassword,
    isValidAdminEmail,
    type LedgerWrite,
    requireReason,
    slugifyTenantName,
    type TenantAdminInvite,
    type TenantPlan,
    type TenantRecord,
    type TenantStatus,
    type TenantUserAccount,
    type TokenLedgerEntry,
} from "../../../shared/admin/admin-domain.js";

type TenantRow = {
    id: string;
    name: string;
    slug: string;
    status: TenantStatus;
    plan: TenantPlan;
    seats: number;
    billingTerm?: BillingTerm | null;
    startsAt: string;
    expiresAt: string | null;
    tokenBalance: number;
    tokenThreshold: number;
    lastActivityAt: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

function missingTableMessage(error: { message: string; code?: string }): boolean {
    const m = error.message.toLowerCase();
    return (
        error.code === "42P01" ||
        m.includes("schema cache") ||
        /relation .* does not exist/.test(m) ||
        m.includes("could not find the table")
    );
}

function throwStoreError(action: string, error: { message: string; code?: string }): never {
    if (missingTableMessage(error)) {
        throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
                "Tenant tables are not migrated. Apply vertex/prisma/migrations/20261015120000_super_admin_tenants/migration.sql in Supabase SQL editor.",
        });
    }
    throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to ${action}: ${error.message}`,
    });
}

function iso(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : value;
}

function isMissingColumn(error: { message: string; code?: string }, column: string): boolean {
    const message = (error.message ?? "").toLowerCase();
    const col = column.toLowerCase();
    return (
        error.code === "PGRST204" ||
        error.code === "42703" ||
        message.includes(`'${col}'`) ||
        message.includes(`"${col}"`) ||
        message.includes(`${col} does not exist`) ||
        message.includes(`could not find the '${col}' column`)
    );
}

function mapTenant(row: TenantRow, seatsUsed: number): TenantRecord {
    const record: TenantRecord = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        plan: row.plan,
        seats: row.seats,
        seatsUsed,
        billingTerm: row.billingTerm === "annual" ? "annual" : "monthly",
        startsAt: iso(row.startsAt) ?? new Date().toISOString(),
        expiresAt: iso(row.expiresAt),
        tokenBalance: row.tokenBalance,
        tokenThreshold: row.tokenThreshold,
        lastActivityAt: iso(row.lastActivityAt),
        archivedAt: iso(row.archivedAt),
        createdAt: iso(row.createdAt) ?? new Date().toISOString(),
        updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
    };
    return { ...record, status: displayTenantStatus(record) };
}

async function seatsUsedByTenant(
    supabase: SupabaseClient,
    tenantIds: string[],
): Promise<Map<string, number>> {
    const counts = new Map<string, number>(tenantIds.map((id) => [id, 0]));
    if (tenantIds.length === 0) return counts;
    const { data, error } = await supabase.from("users").select("tenantId").in("tenantId", tenantIds);
    if (error) return counts;
    for (const row of data ?? []) {
        const id = row.tenantId as string | null;
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}

export async function listTenants(supabase: SupabaseClient): Promise<TenantRecord[]> {
    const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .is("archivedAt", null)
        .order("name", { ascending: true })
        .limit(500);
    if (error) throwStoreError("list tenants", error);
    const rows = (data ?? []) as TenantRow[];
    const seats = await seatsUsedByTenant(
        supabase,
        rows.map((r) => r.id),
    );
    return rows.map((row) => mapTenant(row, seats.get(row.id) ?? 0));
}

export async function getTenant(supabase: SupabaseClient, tenantId: string): Promise<TenantRecord> {
    const { data, error } = await supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle();
    if (error) throwStoreError("load tenant", error);
    if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
    const seats = await seatsUsedByTenant(supabase, [tenantId]);
    return mapTenant(data as TenantRow, seats.get(tenantId) ?? 0);
}

async function writeAudit(
    supabase: SupabaseClient,
    input: Parameters<typeof buildAuditEntry>[0],
): Promise<void> {
    const entry = buildAuditEntry(input);
    const { error } = await supabase.from("admin_audit_logs").insert({
        id: randomUUID(),
        actorId: entry.actorId,
        tenantId: entry.tenantId,
        action: entry.action,
        before: entry.before,
        after: entry.after,
        reason: entry.reason,
        ipAddress: entry.ipAddress,
    });
    if (error) throwStoreError("write audit log", error);
}

export async function listLedger(supabase: SupabaseClient, tenantId: string): Promise<TokenLedgerEntry[]> {
    const { data, error } = await supabase
        .from("tenant_token_ledger")
        .select("*, actor:users!actorId(email)")
        .eq("tenantId", tenantId)
        .order("createdAt", { ascending: true })
        .limit(2000);
    if (error) throwStoreError("list token ledger", error);
    return (data ?? []).map((row) => {
        const actor = row.actor as { email?: string } | { email?: string }[] | null;
        const actorEmail = Array.isArray(actor) ? actor[0]?.email : actor?.email;
        return {
            id: row.id as string,
            tenantId: row.tenantId as string,
            type: row.type,
            amount: row.amount as number,
            balanceAfter: row.balanceAfter as number,
            actorId: (row.actorId as string | null) ?? null,
            actorEmail: actorEmail ?? null,
            reason: row.reason as string,
            note: (row.note as string | null) ?? null,
            expiresAt: iso(row.expiresAt as string | null),
            createdAt: iso(row.createdAt as string) ?? new Date().toISOString(),
        };
    });
}

async function appendLedger(
    supabase: SupabaseClient,
    tenantId: string,
    write: LedgerWrite,
): Promise<{ entry: TokenLedgerEntry; tenant: TenantRecord }> {
    const existing = await listLedger(supabase, tenantId);
    const applied = applyLedgerWrite(existing, write);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const { error } = await supabase.from("tenant_token_ledger").insert({
        id,
        tenantId,
        type: applied.type,
        amount: applied.amount,
        balanceAfter: applied.balanceAfter,
        actorId: write.actorId ?? null,
        reason: applied.reason,
        note: write.note ?? null,
        expiresAt: write.expiresAt ?? null,
        createdAt,
    });
    if (error) throwStoreError("append token ledger", error);

    const { error: updErr } = await supabase
        .from("tenants")
        .update({
            tokenBalance: applied.balanceAfter,
            lastActivityAt: createdAt,
            updatedAt: createdAt,
        })
        .eq("id", tenantId);
    if (updErr) throwStoreError("update tenant token cache", updErr);

    const tenant = await getTenant(supabase, tenantId);
    return {
        tenant,
        entry: {
            id,
            tenantId,
            type: applied.type,
            amount: applied.amount,
            balanceAfter: applied.balanceAfter,
            actorId: write.actorId ?? null,
            actorEmail: null,
            reason: applied.reason,
            note: write.note ?? null,
            expiresAt: write.expiresAt ?? null,
            createdAt,
        },
    };
}

async function insertTenantRow(supabase: SupabaseClient, row: Record<string, unknown>): Promise<TenantRow> {
    const { data, error } = await supabase.from("tenants").insert(row).select().single();
    if (!error && data) return data as TenantRow;
    if (error && isMissingColumn(error, "billingTerm") && "billingTerm" in row) {
        const withoutBilling = { ...row };
        delete withoutBilling.billingTerm;
        const retry = await supabase.from("tenants").insert(withoutBilling).select().single();
        if (!retry.error && retry.data) return retry.data as TenantRow;
        throwStoreError("create tenant", retry.error ?? error);
    }
    throwStoreError("create tenant", error ?? { message: "unknown error" });
}

async function findAuthUserIdByEmail(supabase: SupabaseClient, email: string): Promise<string | null> {
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = data?.users?.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match?.id) return match.id;
    const { data: link } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
    return link?.user?.id ?? null;
}

async function inviteLinkForEmail(supabase: SupabaseClient, email: string): Promise<string | null> {
    const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
    return data?.properties?.action_link ?? null;
}

async function upsertTenantAdminProfile(
    supabase: SupabaseClient,
    args: { id: string; email: string; fullName: string; tenantId: string },
): Promise<void> {
    const now = new Date().toISOString();
    const profile = {
        id: args.id,
        email: args.email,
        fullName: args.fullName,
        role: "admin" as const,
        tenantId: args.tenantId,
        isActive: true,
        updatedAt: now,
    };
    const { error } = await supabase.from("users").upsert(profile);
    if (!error) return;
    const { error: insertError } = await supabase.from("users").insert({ ...profile, createdAt: now });
    if (!insertError) return;
    const { error: updateError } = await supabase
        .from("users")
        .update({
            fullName: args.fullName,
            role: "admin",
            tenantId: args.tenantId,
            isActive: true,
            updatedAt: now,
        })
        .eq("id", args.id);
    if (updateError) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to attach primary admin: ${updateError.message}`,
        });
    }
}

export async function createPrimaryAdmin(
    supabase: SupabaseClient,
    args: { tenantId: string; name: string; email: string },
): Promise<TenantAdminInvite> {
    const email = args.email.trim().toLowerCase();
    const fullName = args.name.trim();
    if (!fullName) throw new TRPCError({ code: "BAD_REQUEST", message: "Admin name is required" });
    if (!isValidAdminEmail(email)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A valid admin email is required" });
    }
    const tempPassword = generateTempPassword();
    const created = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
    });
    let userId = created.data.user?.id ?? null;
    let issuedPassword: string | null = tempPassword;
    if (!userId) {
        const message = created.error?.message ?? "";
        if (!/already|registered|exists/i.test(message)) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to create primary admin: ${message || "unknown error"}`,
            });
        }
        userId = await findAuthUserIdByEmail(supabase, email);
        issuedPassword = null;
    }
    if (!userId) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create primary admin: user id missing",
        });
    }
    await upsertTenantAdminProfile(supabase, { id: userId, email, fullName, tenantId: args.tenantId });
    return {
        id: userId,
        email,
        fullName,
        role: "admin",
        lastLoginAt: null,
        tempPassword: issuedPassword,
        inviteLink: await inviteLinkForEmail(supabase, email),
    };
}

export async function listTenantUsers(
    supabase: SupabaseClient,
    tenantId: string,
): Promise<TenantUserAccount[]> {
    const { data, error } = await supabase
        .from("users")
        .select("id, email, fullName, role")
        .eq("tenantId", tenantId)
        .order("email", { ascending: true });
    if (error) throwStoreError("list tenant users", error);
    return Promise.all(
        (data ?? []).map(async (row) => {
            let lastLoginAt: string | null = null;
            try {
                const { data: auth } = await supabase.auth.admin.getUserById(row.id as string);
                lastLoginAt = iso(auth?.user?.last_sign_in_at ?? null);
            } catch {
                lastLoginAt = null;
            }
            const role = row.role as TenantUserAccount["role"];
            return {
                id: row.id as string,
                email: (row.email as string) ?? "",
                fullName: (row.fullName as string | null) ?? null,
                role: role === "super_admin" || role === "admin" ? role : "clinician",
                lastLoginAt,
            };
        }),
    );
}

export async function createTenant(
    supabase: SupabaseClient,
    args: {
        name: string;
        plan: TenantPlan;
        seats: number;
        status: "active" | "trial";
        billingTerm?: BillingTerm;
        adminName: string;
        adminEmail: string;
        startsAt?: string;
        expiresAt?: string | null;
        initialTokens?: number;
        reason: string;
        actorId: string;
        ip: string | null;
    },
): Promise<{ tenant: TenantRecord; admin: TenantAdminInvite }> {
    const reason = requireReason(args.reason);
    const name = args.name.trim();
    if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant name is required" });
    if (!Number.isInteger(args.seats) || args.seats < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Seats must be at least 1" });
    }
    const billingTerm: BillingTerm = args.billingTerm === "annual" ? "annual" : "monthly";
    const id = randomUUID();
    const now = new Date().toISOString();
    const startsAt = args.startsAt ?? now;
    const expiresAt = args.expiresAt ?? computeLicenseExpiry(startsAt, args.status, billingTerm);
    const slugBase = slugifyTenantName(name);
    const slug = `${slugBase}-${id.slice(0, 8)}`;
    const data = await insertTenantRow(supabase, {
        id,
        name,
        slug,
        status: args.status,
        plan: args.plan,
        seats: args.seats,
        billingTerm,
        startsAt,
        expiresAt,
        tokenBalance: 0,
        tokenThreshold: 50,
        createdAt: now,
        updatedAt: now,
    });

    if (args.initialTokens && args.initialTokens !== 0) {
        await appendLedger(supabase, id, {
            type: "grant",
            amount: args.initialTokens,
            reason,
            note: "Initial grant",
            actorId: args.actorId,
        });
    }

    const admin = await createPrimaryAdmin(supabase, {
        tenantId: id,
        name: args.adminName,
        email: args.adminEmail,
    });

    const { error: clearActivityError } = await supabase
        .from("tenants")
        .update({ lastActivityAt: null })
        .eq("id", id);
    if (clearActivityError && !isMissingColumn(clearActivityError, "lastActivityAt")) {
        throwStoreError("clear tenant activity", clearActivityError);
    }

    await writeAudit(supabase, {
        action: "tenant.created",
        reason,
        actorId: args.actorId,
        tenantId: id,
        before: null,
        after: { ...data, adminId: admin.id, adminEmail: admin.email },
        ipAddress: args.ip,
    });
    return { tenant: await getTenant(supabase, id), admin };
}

export async function updateTenantLicense(
    supabase: SupabaseClient,
    args: {
        tenantId: string;
        plan: TenantPlan;
        seats: number;
        billingTerm: BillingTerm;
        startsAt: string;
        expiresAt: string | null;
        status: TenantStatus;
        reason: string;
        actorId: string;
        ip: string | null;
    },
): Promise<TenantRecord> {
    const reason = requireReason(args.reason);
    const before = await getTenant(supabase, args.tenantId);
    if (args.status === "archived") {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Archive from the overflow menu — license save cannot archive a tenant",
        });
    }
    const now = new Date().toISOString();
    const billingTerm: BillingTerm = args.billingTerm === "annual" ? "annual" : "monthly";
    const patch = {
        plan: args.plan,
        seats: args.seats,
        billingTerm,
        startsAt: args.startsAt,
        expiresAt: args.expiresAt,
        status: args.status,
        updatedAt: now,
    };
    const { error } = await supabase.from("tenants").update(patch).eq("id", args.tenantId);
    if (error && isMissingColumn(error, "billingTerm")) {
        const withoutBilling = { ...patch };
        delete withoutBilling.billingTerm;
        const retry = await supabase.from("tenants").update(withoutBilling).eq("id", args.tenantId);
        if (retry.error) throwStoreError("update license", retry.error);
    } else if (error) {
        throwStoreError("update license", error);
    }
    const after = await getTenant(supabase, args.tenantId);
    await writeAudit(supabase, {
        action: "tenant.license_updated",
        reason,
        actorId: args.actorId,
        tenantId: args.tenantId,
        before,
        after,
        ipAddress: args.ip,
    });
    return after;
}

export async function extendTenant(
    supabase: SupabaseClient,
    args: {
        tenantId: string;
        days?: number;
        expiresAt?: string;
        reason: string;
        actorId: string;
        ip: string | null;
    },
): Promise<{ tenant: TenantRecord; from: string | null; to: string }> {
    const reason = requireReason(args.reason);
    const before = await getTenant(supabase, args.tenantId);
    const to = args.expiresAt ?? extendExpiry(before.expiresAt, args.days ?? 30);
    const now = new Date().toISOString();
    const nextStatus = before.status === "expired" || before.status === "archived" ? "active" : before.status;
    const { error } = await supabase
        .from("tenants")
        .update({
            expiresAt: to,
            status: nextStatus,
            lastActivityAt: now,
            updatedAt: now,
        })
        .eq("id", args.tenantId);
    if (error) throwStoreError("extend license", error);
    const after = await getTenant(supabase, args.tenantId);
    await writeAudit(supabase, {
        action: "tenant.extended",
        reason,
        actorId: args.actorId,
        tenantId: args.tenantId,
        before: { expiresAt: before.expiresAt, status: before.status },
        after: { expiresAt: after.expiresAt, status: after.status },
        ipAddress: args.ip,
    });
    return { tenant: after, from: before.expiresAt, to };
}

export async function grantTenantTokens(
    supabase: SupabaseClient,
    args: {
        tenantId: string;
        amount: number;
        reason: string;
        note?: string | null;
        expiresAt?: string | null;
        actorId: string;
        ip: string | null;
    },
): Promise<{ tenant: TenantRecord; entry: TokenLedgerEntry; from: number; to: number }> {
    const before = await getTenant(supabase, args.tenantId);
    const { tenant, entry } = await appendLedger(supabase, args.tenantId, {
        type: args.amount < 0 ? "adjustment" : "grant",
        amount: args.amount,
        reason: args.reason,
        note: args.note ?? null,
        actorId: args.actorId,
        expiresAt: args.expiresAt ?? null,
    });
    await writeAudit(supabase, {
        action: "tenant.grant_tokens",
        reason: args.reason,
        actorId: args.actorId,
        tenantId: args.tenantId,
        before: { tokenBalance: before.tokenBalance },
        after: { tokenBalance: tenant.tokenBalance },
        ipAddress: args.ip,
    });
    return { tenant, entry, from: before.tokenBalance, to: tenant.tokenBalance };
}

export async function setTenantStatus(
    supabase: SupabaseClient,
    args: {
        tenantId: string;
        status: "suspended" | "active" | "trial";
        reason: string;
        actorId: string;
        ip: string | null;
        confirmName?: string;
    },
): Promise<TenantRecord> {
    const reason = requireReason(args.reason);
    const before = await getTenant(supabase, args.tenantId);
    if (args.status === "suspended" && args.confirmName !== undefined) {
        if (args.confirmName.trim() !== before.name) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Type the tenant name "${before.name}" to confirm suspend`,
            });
        }
    }
    const now = new Date().toISOString();
    const { error } = await supabase
        .from("tenants")
        .update({
            status: args.status,
            lastActivityAt: now,
            updatedAt: now,
        })
        .eq("id", args.tenantId);
    if (error) throwStoreError("update tenant status", error);
    const after = await getTenant(supabase, args.tenantId);
    await writeAudit(supabase, {
        action: args.status === "suspended" ? "tenant.suspended" : "tenant.reactivated",
        reason,
        actorId: args.actorId,
        tenantId: args.tenantId,
        before: { status: before.status },
        after: { status: after.status },
        ipAddress: args.ip,
    });
    return after;
}

export async function archiveTenant(
    supabase: SupabaseClient,
    args: { tenantId: string; reason: string; actorId: string; ip: string | null },
): Promise<TenantRecord> {
    const reason = requireReason(args.reason);
    const before = await getTenant(supabase, args.tenantId);
    const now = new Date().toISOString();
    const { error } = await supabase
        .from("tenants")
        .update({
            status: "archived",
            archivedAt: now,
            lastActivityAt: now,
            updatedAt: now,
        })
        .eq("id", args.tenantId);
    if (error) throwStoreError("archive tenant", error);
    const after = await getTenant(supabase, args.tenantId);
    await writeAudit(supabase, {
        action: "tenant.archived",
        reason,
        actorId: args.actorId,
        tenantId: args.tenantId,
        before: { status: before.status, archivedAt: before.archivedAt },
        after: { status: after.status, archivedAt: after.archivedAt },
        ipAddress: args.ip,
    });
    return after;
}

export async function undoGrant(
    supabase: SupabaseClient,
    args: {
        tenantId: string;
        amount: number;
        actorId: string;
        ip: string | null;
    },
): Promise<{ tenant: TenantRecord; entry: TokenLedgerEntry }> {
    const before = await getTenant(supabase, args.tenantId);
    const { tenant, entry } = await appendLedger(supabase, args.tenantId, {
        type: "adjustment",
        amount: -args.amount,
        reason: "Undo grant",
        note: "Reversal within undo window",
        actorId: args.actorId,
    });
    await writeAudit(supabase, {
        action: "tenant.grant_tokens_undone",
        reason: "Undo grant",
        actorId: args.actorId,
        tenantId: args.tenantId,
        before: { tokenBalance: before.tokenBalance },
        after: { tokenBalance: tenant.tokenBalance },
        ipAddress: args.ip,
    });
    return { tenant, entry };
}

export async function listAdminAudit(
    supabase: SupabaseClient,
    args: {
        tenantId?: string;
        action?: string;
        from?: string;
        to?: string;
        limit?: number;
    },
): Promise<AdminAuditEntry[]> {
    let query = supabase
        .from("admin_audit_logs")
        .select("*, actor:users!actorId(email), tenant:tenants!tenantId(name)")
        .order("createdAt", { ascending: false })
        .limit(args.limit ?? 200);
    if (args.tenantId) query = query.eq("tenantId", args.tenantId);
    if (args.action) query = query.eq("action", args.action);
    if (args.from) query = query.gte("createdAt", args.from);
    if (args.to) query = query.lte("createdAt", args.to);
    const { data, error } = await query;
    if (error) throwStoreError("list audit logs", error);
    return (data ?? []).map((row) => {
        const actor = row.actor as { email?: string } | { email?: string }[] | null;
        const tenant = row.tenant as { name?: string } | { name?: string }[] | null;
        const actorEmail = Array.isArray(actor) ? actor[0]?.email : actor?.email;
        const tenantName = Array.isArray(tenant) ? tenant[0]?.name : tenant?.name;
        return {
            id: row.id as string,
            actorId: (row.actorId as string | null) ?? null,
            actorEmail: actorEmail ?? null,
            tenantId: (row.tenantId as string | null) ?? null,
            tenantName: tenantName ?? null,
            action: row.action as string,
            before: row.before ?? null,
            after: row.after ?? null,
            reason: row.reason as string,
            ipAddress: (row.ipAddress as string | null) ?? null,
            createdAt: iso(row.createdAt as string) ?? new Date().toISOString(),
        };
    });
}

export async function exportAdminAuditCsv(
    supabase: SupabaseClient,
    args: { tenantId?: string; action?: string; from?: string; to?: string },
): Promise<string> {
    const rows = await listAdminAudit(supabase, { ...args, limit: 2000 });
    return auditRowsToCsv(rows);
}
