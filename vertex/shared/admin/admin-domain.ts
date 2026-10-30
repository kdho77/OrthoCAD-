// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

/** Commercial tenant layer for the super-admin dashboard. CAD still uses per-user License + tokenBalance. */

export const TENANT_PLANS = ["starter", "professional", "clinic", "enterprise"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const TENANT_STATUSES = ["active", "trial", "suspended", "expired", "archived"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const LEDGER_TYPES = ["grant", "usage", "adjustment", "expiry"] as const;
export type TokenLedgerType = (typeof LEDGER_TYPES)[number];

export const GRANT_REASONS = ["Purchase", "Comp", "Correction", "custom"] as const;
export type GrantReasonKind = (typeof GRANT_REASONS)[number];

export const BILLING_TERMS = ["monthly", "annual"] as const;
export type BillingTerm = (typeof BILLING_TERMS)[number];

export const TRIAL_LENGTH_DAYS = 7;
export const DEFAULT_TOKEN_THRESHOLD = 50;
export const UNDO_WINDOW_MS = 10_000;

export const PLAN_LABELS: Record<TenantPlan, string> = {
    starter: "Starter",
    professional: "Professional",
    clinic: "Clinic",
    enterprise: "Enterprise",
};

export const STATUS_LABELS: Record<TenantStatus, string> = {
    active: "Active",
    trial: "Trial",
    suspended: "Suspended",
    expired: "Expired",
    archived: "Archived",
};

export const BILLING_TERM_LABELS: Record<BillingTerm, string> = {
    monthly: "Monthly",
    annual: "Annual",
};

export interface TenantRecord {
    id: string;
    name: string;
    slug: string;
    status: TenantStatus;
    plan: TenantPlan;
    seats: number;
    seatsUsed: number;
    billingTerm: BillingTerm;
    startsAt: string;
    expiresAt: string | null;
    tokenBalance: number;
    tokenThreshold: number;
    lastActivityAt: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface TokenLedgerEntry {
    id: string;
    tenantId: string;
    type: TokenLedgerType;
    amount: number;
    balanceAfter: number;
    actorId: string | null;
    actorEmail: string | null;
    reason: string;
    note: string | null;
    expiresAt: string | null;
    createdAt: string;
}

export interface TenantUserAccount {
    id: string;
    fullName: string | null;
    email: string;
    role: "super_admin" | "admin" | "clinician";
    lastLoginAt: string | null;
}

export interface TenantAdminInvite extends TenantUserAccount {
    tempPassword: string | null;
    inviteLink: string | null;
}

export const ROLE_LABELS: Record<TenantUserAccount["role"], string> = {
    super_admin: "Super admin",
    admin: "Admin",
    clinician: "Clinician",
};

export function isValidAdminEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function demoUsersForTenant(tenant: TenantRecord): TenantUserAccount[] {
    return Array.from({ length: Math.max(0, tenant.seatsUsed) }, (_, index) => ({
        id: `${tenant.id}-user-${index}`,
        fullName: index === 0 ? `${tenant.name} Admin` : `User ${index + 1}`,
        email: index === 0 ? `admin@${tenant.slug}.example` : `user${index + 1}@${tenant.slug}.example`,
        role: index === 0 ? "admin" : "clinician",
        lastLoginAt: index === 0 ? tenant.lastActivityAt : null,
    }));
}

export interface AdminAuditEntry {
    id: string;
    actorId: string | null;
    actorEmail: string | null;
    tenantId: string | null;
    tenantName: string | null;
    action: string;
    before: unknown;
    after: unknown;
    reason: string;
    ipAddress: string | null;
    createdAt: string;
}

export interface LedgerWrite {
    type: TokenLedgerType;
    amount: number;
    reason: string;
    note?: string | null;
    actorId?: string | null;
    expiresAt?: string | null;
}

export interface TenantListFilters {
    q: string;
    status: TenantStatus[];
    plan: TenantPlan[];
    expiring: boolean;
    tile: "active" | "expiring" | "suspended" | "low" | null;
    sort: TenantSortKey;
    dir: "asc" | "desc";
}

export type TenantSortKey = "name" | "plan" | "expiry" | "status" | "tokens" | "activity" | "seats";

export const EMPTY_TENANT_FILTERS: TenantListFilters = {
    q: "",
    status: [],
    plan: [],
    expiring: false,
    tile: null,
    sort: "name",
    dir: "asc",
};

/** Parse admin timestamps as UTC when the DB omits a timezone (avoids "in 6 hours"). */
export function parseAdminInstant(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return new Date(`${trimmed}T00:00:00.000Z`);
    }
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
        return new Date(`${trimmed.replace(" ", "T")}Z`);
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function addUtcDays(startsAt: string, days: number): string {
    const start = parseAdminInstant(startsAt) ?? new Date();
    return new Date(start.getTime() + days * 864e5).toISOString();
}

export function addUtcMonths(startsAt: string, months: number): string {
    const start = parseAdminInstant(startsAt) ?? new Date();
    return new Date(
        Date.UTC(
            start.getUTCFullYear(),
            start.getUTCMonth() + months,
            start.getUTCDate(),
            start.getUTCHours(),
            start.getUTCMinutes(),
            start.getUTCSeconds(),
            start.getUTCMilliseconds(),
        ),
    ).toISOString();
}

export function computeLicenseExpiry(
    startsAt: string,
    status: TenantStatus | "active" | "trial",
    billingTerm: BillingTerm,
): string {
    if (status === "trial") return addUtcDays(startsAt, TRIAL_LENGTH_DAYS);
    return billingTerm === "monthly" ? addUtcMonths(startsAt, 1) : addUtcMonths(startsAt, 12);
}

export function generateTempPassword(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = new Uint8Array(12);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (Math.random() * chars.length) | 0;
    }
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function slugifyTenantName(name: string): string {
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return slug || "tenant";
}

/** Balance is the sum of ledger amounts. Never set a balance field directly. */
export function balanceFromLedger(entries: ReadonlyArray<{ amount: number }>): number {
    return entries.reduce((sum, row) => sum + row.amount, 0);
}

export function assertLedgerBalanced(
    entries: ReadonlyArray<{ amount: number; balanceAfter: number }>,
): number {
    let running = 0;
    for (const row of entries) {
        running += row.amount;
        if (row.balanceAfter !== running) {
            throw new Error(
                `Ledger snapshot mismatch: expected balanceAfter ${running}, got ${row.balanceAfter}`,
            );
        }
    }
    return running;
}

export function applyLedgerWrite(
    existing: ReadonlyArray<{ amount: number }>,
    write: LedgerWrite,
): { amount: number; balanceAfter: number; type: TokenLedgerType; reason: string } {
    const reason = write.reason.trim();
    if (!reason) {
        throw new Error("A reason is required for every ledger write");
    }
    if (!Number.isInteger(write.amount) || write.amount === 0) {
        throw new Error("Ledger amount must be a non-zero integer");
    }
    const balanceAfter = balanceFromLedger(existing) + write.amount;
    return { amount: write.amount, balanceAfter, type: write.type, reason };
}

export function usageThisMonth(
    entries: ReadonlyArray<{ type: TokenLedgerType; amount: number; createdAt: string }>,
    now = new Date(),
): number {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return entries
        .filter((row) => row.type === "usage" && new Date(row.createdAt) >= start)
        .reduce((sum, row) => sum + Math.abs(row.amount), 0);
}

export function monthlyBurnRate(
    entries: ReadonlyArray<{ type: TokenLedgerType; amount: number; createdAt: string }>,
    now = new Date(),
): number {
    const used = usageThisMonth(entries, now);
    const day = Math.max(1, now.getUTCDate());
    return Math.round((used / day) * 30);
}

export function displayTenantStatus(
    tenant: {
        status: TenantStatus;
        expiresAt: string | null;
        archivedAt?: string | null;
    },
    now = new Date(),
): TenantStatus {
    if (tenant.archivedAt || tenant.status === "archived") return "archived";
    if (tenant.status === "suspended") return "suspended";
    const expiry = parseAdminInstant(tenant.expiresAt);
    if (expiry && expiry.getTime() < now.getTime()) return "expired";
    return tenant.status;
}

export function isExpiringWithin(expiresAt: string | null, days: number, now = new Date()): boolean {
    if (!expiresAt) return false;
    const when = parseAdminInstant(expiresAt);
    if (!when) return false;
    const ms = when.getTime() - now.getTime();
    return ms > 0 && ms <= days * 864e5;
}

export function isExpired(expiresAt: string | null, now = new Date()): boolean {
    const when = parseAdminInstant(expiresAt);
    return Boolean(when && when.getTime() < now.getTime());
}

export function isLowTokenBalance(balance: number, threshold: number): boolean {
    return balance < threshold;
}

export function expiryTone(expiresAt: string | null, now = new Date()): "ok" | "amber" | "red" {
    if (!expiresAt) return "ok";
    if (isExpired(expiresAt, now)) return "red";
    if (isExpiringWithin(expiresAt, 30, now)) return "amber";
    return "ok";
}

export function extendExpiry(current: string | null, days: number, now = new Date()): string {
    const currentMs = parseAdminInstant(current)?.getTime() ?? 0;
    const baseMs = Math.max(currentMs, now.getTime());
    return new Date(baseMs + days * 864e5).toISOString();
}

export function relativeTime(iso: string | null, now = new Date(), empty = "—"): string {
    if (!iso) return empty;
    const when = parseAdminInstant(iso);
    if (!when) return empty;
    const delta = when.getTime() - now.getTime();
    const abs = Math.abs(delta);
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const format = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
    let value: string;
    if (abs < hour) value = format(Math.max(1, Math.round(abs / minute)), "minute");
    else if (abs < day) value = format(Math.round(abs / hour), "hour");
    else if (abs < 45 * day) value = format(Math.round(abs / day), "day");
    else value = format(Math.round(abs / (30 * day)), "month");
    if (abs < 2 * minute) return "just now";
    return delta >= 0 ? `in ${value}` : `${value} ago`;
}

export function relativeActivityTime(iso: string | null, now = new Date()): string {
    return relativeTime(iso, now, "Never");
}

export function formatAbsolute(iso: string | null): string {
    if (!iso) return "—";
    const when = parseAdminInstant(iso);
    if (!when) return "—";
    return when.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatDateOnly(iso: string | null): string {
    if (!iso) return "—";
    const when = parseAdminInstant(iso);
    if (!when) return "—";
    return when.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

export function requireReason(reason: string | undefined | null): string {
    const trimmed = reason?.trim() ?? "";
    if (!trimmed) {
        throw new Error("A reason is required for every admin write");
    }
    return trimmed;
}

export function buildAuditEntry(input: {
    action: string;
    reason: string;
    actorId?: string | null;
    tenantId?: string | null;
    before?: unknown;
    after?: unknown;
    ipAddress?: string | null;
}): Omit<AdminAuditEntry, "id" | "createdAt" | "actorEmail" | "tenantName"> {
    return {
        actorId: input.actorId ?? null,
        tenantId: input.tenantId ?? null,
        action: input.action,
        before: input.before ?? null,
        after: input.after ?? null,
        reason: requireReason(input.reason),
        ipAddress: input.ipAddress ?? null,
    };
}

export function tileCounts(tenants: TenantRecord[], now = new Date()) {
    return {
        active: tenants.filter((t) => displayTenantStatus(t, now) === "active").length,
        expiring: tenants.filter(
            (t) =>
                displayTenantStatus(t, now) !== "suspended" &&
                displayTenantStatus(t, now) !== "archived" &&
                isExpiringWithin(t.expiresAt, 30, now),
        ).length,
        suspended: tenants.filter((t) => displayTenantStatus(t, now) === "suspended").length,
        low: tenants.filter((t) => isLowTokenBalance(t.tokenBalance, t.tokenThreshold)).length,
    };
}

export function matchesTenantFilters(
    tenant: TenantRecord,
    filters: TenantListFilters,
    now = new Date(),
): boolean {
    const status = displayTenantStatus(tenant, now);
    if (filters.tile === "active" && status !== "active") return false;
    if (filters.tile === "suspended" && status !== "suspended") return false;
    if (
        filters.tile === "expiring" &&
        !(status !== "suspended" && status !== "archived" && isExpiringWithin(tenant.expiresAt, 30, now))
    ) {
        return false;
    }
    if (filters.tile === "low" && !isLowTokenBalance(tenant.tokenBalance, tenant.tokenThreshold)) {
        return false;
    }
    if (filters.status.length > 0 && !filters.status.includes(status)) return false;
    if (filters.plan.length > 0 && !filters.plan.includes(tenant.plan)) return false;
    if (filters.expiring && !isExpiringWithin(tenant.expiresAt, 30, now) && status !== "expired") {
        return false;
    }
    const q = filters.q.trim().toLowerCase();
    if (q && !tenant.name.toLowerCase().includes(q) && !tenant.slug.toLowerCase().includes(q)) {
        return false;
    }
    return true;
}

export function sortTenants(
    tenants: TenantRecord[],
    sort: TenantSortKey,
    dir: "asc" | "desc",
    now = new Date(),
): TenantRecord[] {
    const sign = dir === "asc" ? 1 : -1;
    return [...tenants].sort((a, b) => {
        const cmp = (left: string | number, right: string | number) =>
            left < right ? -sign : left > right ? sign : 0;
        switch (sort) {
            case "plan":
                return cmp(a.plan, b.plan);
            case "status":
                return cmp(displayTenantStatus(a, now), displayTenantStatus(b, now));
            case "tokens":
                return cmp(a.tokenBalance, b.tokenBalance);
            case "seats":
                return cmp(a.seatsUsed / Math.max(1, a.seats), b.seatsUsed / Math.max(1, b.seats));
            case "expiry": {
                const ax = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
                const bx = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
                return cmp(ax, bx);
            }
            case "activity": {
                const ax = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
                const bx = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
                return cmp(ax, bx);
            }
            default:
                return cmp(a.name.toLowerCase(), b.name.toLowerCase());
        }
    });
}

export function parseTenantListSearch(search: string): TenantListFilters {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const status = params
        .getAll("status")
        .flatMap((v) => v.split(","))
        .filter((v): v is TenantStatus => (TENANT_STATUSES as readonly string[]).includes(v));
    const plan = params
        .getAll("plan")
        .flatMap((v) => v.split(","))
        .filter((v): v is TenantPlan => (TENANT_PLANS as readonly string[]).includes(v));
    const tileRaw = params.get("tile");
    const tile =
        tileRaw === "active" || tileRaw === "expiring" || tileRaw === "suspended" || tileRaw === "low"
            ? tileRaw
            : null;
    const sortRaw = params.get("sort");
    const sort: TenantSortKey =
        sortRaw === "plan" ||
        sortRaw === "expiry" ||
        sortRaw === "status" ||
        sortRaw === "tokens" ||
        sortRaw === "activity" ||
        sortRaw === "seats" ||
        sortRaw === "name"
            ? sortRaw
            : "name";
    const dir = params.get("dir") === "desc" ? "desc" : "asc";
    return {
        q: params.get("q") ?? "",
        status,
        plan,
        expiring: params.get("expiring") === "1" || params.get("expiring") === "true",
        tile,
        sort,
        dir,
    };
}

export function serializeTenantListSearch(filters: TenantListFilters): string {
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.status.length) params.set("status", filters.status.join(","));
    if (filters.plan.length) params.set("plan", filters.plan.join(","));
    if (filters.expiring) params.set("expiring", "1");
    if (filters.tile) params.set("tile", filters.tile);
    if (filters.sort !== "name") params.set("sort", filters.sort);
    if (filters.dir !== "asc") params.set("dir", filters.dir);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
}

export function parseAdminPath(
    pathname: string,
    search = "",
):
    | { page: "tenants"; filters: TenantListFilters }
    | { page: "tenant"; id: string; tab: "overview" | "license" | "users" | "tokens" | "audit" }
    | { page: "audit" }
    | { page: "none" } {
    const path = pathname.replace(/\/+$/, "") || "/";
    if (path === "/admin") return { page: "tenants", filters: parseTenantListSearch(search) };
    if (path === "/admin/audit") return { page: "audit" };
    const match = path.match(/^\/admin\/tenants\/([^/]+)$/);
    if (match) {
        const tabRaw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("tab");
        const tab =
            tabRaw === "license" ||
            tabRaw === "users" ||
            tabRaw === "tokens" ||
            tabRaw === "audit" ||
            tabRaw === "overview"
                ? tabRaw
                : "overview";
        return { page: "tenant", id: match[1], tab };
    }
    return { page: "none" };
}

export function isAdminPath(pathname: string): boolean {
    return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function grantPreview(balance: number, amount: number): { from: number; to: number } {
    return { from: balance, to: balance + amount };
}

export function csvEscape(value: string): string {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}

export function auditRowsToCsv(rows: AdminAuditEntry[]): string {
    const header = ["when", "actor", "tenant", "action", "before", "after", "reason"];
    const lines = rows.map((row) =>
        [
            row.createdAt,
            row.actorEmail ?? row.actorId ?? "",
            row.tenantName ?? row.tenantId ?? "",
            row.action,
            JSON.stringify(row.before ?? null),
            JSON.stringify(row.after ?? null),
            row.reason,
        ]
            .map(csvEscape)
            .join(","),
    );
    return [header.join(","), ...lines].join("\n");
}

export const DEMO_TENANTS: TenantRecord[] = [
    {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Apex Clinic",
        slug: "apex-clinic",
        status: "active",
        plan: "professional",
        seats: 5,
        seatsUsed: 3,
        billingTerm: "annual",
        startsAt: "2026-01-15T00:00:00.000Z",
        expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(),
        tokenBalance: 400,
        tokenThreshold: 50,
        lastActivityAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
        archivedAt: null,
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
    },
    {
        id: "22222222-2222-4222-8222-222222222222",
        name: "North Shore Orthotics",
        slug: "north-shore",
        status: "active",
        plan: "clinic",
        seats: 10,
        seatsUsed: 8,
        billingTerm: "monthly",
        startsAt: "2026-03-01T00:00:00.000Z",
        expiresAt: new Date(Date.now() + 12 * 864e5).toISOString(),
        tokenBalance: 80,
        tokenThreshold: 50,
        lastActivityAt: new Date(Date.now() - 26 * 3600e3).toISOString(),
        archivedAt: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
    },
    {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Harbor Podiatry",
        slug: "harbor-podiatry",
        status: "suspended",
        plan: "starter",
        seats: 2,
        seatsUsed: 1,
        billingTerm: "monthly",
        startsAt: "2025-11-01T00:00:00.000Z",
        expiresAt: new Date(Date.now() + 120 * 864e5).toISOString(),
        tokenBalance: 20,
        tokenThreshold: 50,
        lastActivityAt: new Date(Date.now() - 14 * 864e5).toISOString(),
        archivedAt: null,
        createdAt: "2025-11-01T00:00:00.000Z",
        updatedAt: "2025-11-01T00:00:00.000Z",
    },
    {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Metro Ortho Lab",
        slug: "metro-ortho",
        status: "active",
        plan: "enterprise",
        seats: 25,
        seatsUsed: 18,
        billingTerm: "annual",
        startsAt: "2025-06-01T00:00:00.000Z",
        expiresAt: new Date(Date.now() - 5 * 864e5).toISOString(),
        tokenBalance: 12,
        tokenThreshold: 50,
        lastActivityAt: new Date(Date.now() - 40 * 864e5).toISOString(),
        archivedAt: null,
        createdAt: "2025-06-01T00:00:00.000Z",
        updatedAt: "2025-06-01T00:00:00.000Z",
    },
];
