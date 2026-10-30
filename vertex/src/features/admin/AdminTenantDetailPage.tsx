// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { navigate } from "@/features/admin/admin-nav";
import { cn } from "@/lib/utils";
import {
    type AdminAuditEntry,
    BILLING_TERM_LABELS,
    BILLING_TERMS,
    type BillingTerm,
    computeLicenseExpiry,
    formatAbsolute,
    formatDateOnly,
    monthlyBurnRate,
    PLAN_LABELS,
    ROLE_LABELS,
    relativeActivityTime,
    relativeTime,
    TENANT_PLANS,
    TENANT_STATUSES,
    type TenantPlan,
    type TenantRecord,
    type TenantStatus,
    type TenantUserAccount,
    type TokenLedgerEntry,
    usageThisMonth,
} from "../../../shared/admin/admin-domain";
import type { AdminModal } from "./AdminModals";
import { ExpiryCell, SeatsBar, StatusPill, TokenCell } from "./admin-ui";

interface AdminTenantDetailPageProps {
    tenant: TenantRecord;
    ledger: TokenLedgerEntry[];
    audit: AdminAuditEntry[];
    users: TenantUserAccount[];
    tab: "overview" | "license" | "users" | "tokens" | "audit";
    onOpen: (modal: AdminModal) => void;
    onSaveLicense: (input: {
        plan: TenantPlan;
        seats: number;
        billingTerm: BillingTerm;
        startsAt: string;
        expiresAt: string | null;
        status: Exclude<TenantStatus, "archived">;
        reason: string;
    }) => Promise<void>;
    busy: boolean;
}

export function AdminTenantDetailPage({
    tenant,
    ledger,
    audit,
    users,
    tab,
    onOpen,
    onSaveLicense,
    busy,
}: AdminTenantDetailPageProps) {
    const suspended = tenant.status === "suspended";
    return (
        <div className="mx-auto w-full max-w-5xl space-y-5 p-6">
            <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => navigate("/admin")}
            >
                ← Tenants
            </button>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <h1 className="text-xl font-semibold">{tenant.name}</h1>
                        <StatusPill tenant={tenant} />
                        <span className="text-xs text-muted-foreground">{PLAN_LABELS[tenant.plan]}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>
                            Seats {tenant.seatsUsed}/{tenant.seats}
                        </span>
                        <span>
                            Expiry <ExpiryCell iso={tenant.expiresAt} />
                        </span>
                        <span>
                            Tokens{" "}
                            <TokenCell balance={tenant.tokenBalance} threshold={tenant.tokenThreshold} />
                        </span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => onOpen({ kind: "extend", tenant })}>
                        Extend
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onOpen({ kind: "grant", tenant })}>
                        Grant tokens
                    </Button>
                    <Button
                        size="sm"
                        variant={suspended ? "default" : "destructive"}
                        onClick={() =>
                            onOpen(suspended ? { kind: "reactivate", tenant } : { kind: "suspend", tenant })
                        }
                    >
                        {suspended ? "Reactivate" : "Suspend"}
                    </Button>
                </div>
            </div>

            <Tabs value={tab} onValueChange={(value) => navigate(`/admin/tenants/${tenant.id}?tab=${value}`)}>
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="license">License</TabsTrigger>
                    <TabsTrigger value="users">Users</TabsTrigger>
                    <TabsTrigger value="tokens">Tokens</TabsTrigger>
                    <TabsTrigger value="audit">Audit</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                    <OverviewTab tenant={tenant} />
                </TabsContent>
                <TabsContent value="license">
                    <LicenseTab tenant={tenant} onSave={onSaveLicense} busy={busy} />
                </TabsContent>
                <TabsContent value="users">
                    <UsersTab users={users} seats={tenant.seats} />
                </TabsContent>
                <TabsContent value="tokens">
                    <TokensTab
                        tenant={tenant}
                        ledger={ledger}
                        onGrant={() => onOpen({ kind: "grant", tenant })}
                    />
                </TabsContent>
                <TabsContent value="audit">
                    <AuditTable rows={audit} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function OverviewTab({ tenant }: { tenant: TenantRecord }) {
    return (
        <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Plan" value={PLAN_LABELS[tenant.plan]} />
            <Info label="Status" value={tenant.status} />
            <div className="rounded-md border border-border bg-panel p-3">
                <div className="text-[11px] text-muted-foreground">Seats</div>
                <SeatsBar used={tenant.seatsUsed} total={tenant.seats} />
            </div>
            <Info label="Billing term" value={BILLING_TERM_LABELS[tenant.billingTerm]} />
            <div className="rounded-md border border-border bg-panel p-3">
                <div className="text-[11px] text-muted-foreground">Last activity</div>
                <div className="mt-1">{relativeActivityTime(tenant.lastActivityAt)}</div>
            </div>
            <Info label="Starts" value={formatAbsolute(tenant.startsAt)} />
            <Info label="Expires" value={formatDateOnly(tenant.expiresAt)} />
        </div>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-border bg-panel p-3">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-1 capitalize">{value}</div>
        </div>
    );
}

function LicenseTab({
    tenant,
    onSave,
    busy,
}: {
    tenant: TenantRecord;
    onSave: AdminTenantDetailPageProps["onSaveLicense"];
    busy: boolean;
}) {
    const [plan, setPlan] = useState<TenantPlan>(tenant.plan);
    const [seats, setSeats] = useState(tenant.seats);
    const [billingTerm, setBillingTerm] = useState<BillingTerm>(tenant.billingTerm);
    const [startsAt, setStartsAt] = useState(tenant.startsAt.slice(0, 10));
    const [expiresAt, setExpiresAt] = useState(tenant.expiresAt ? tenant.expiresAt.slice(0, 10) : "");
    const [status, setStatus] = useState<Exclude<TenantStatus, "archived">>(
        tenant.status === "archived" ? "active" : tenant.status,
    );
    const [reason, setReason] = useState("");
    const [message, setMessage] = useState<string | null>(null);

    const applyComputedExpiry = (
        nextStart: string,
        nextStatus: Exclude<TenantStatus, "archived">,
        nextTerm: BillingTerm,
    ) => {
        const startIso = new Date(`${nextStart}T00:00:00.000Z`).toISOString();
        const computed = computeLicenseExpiry(
            startIso,
            nextStatus === "trial" ? "trial" : "active",
            nextTerm,
        );
        setExpiresAt(computed.slice(0, 10));
    };

    const nextStarts = new Date(`${startsAt}T00:00:00.000Z`).toISOString();
    const nextExpires = expiresAt ? new Date(`${expiresAt}T00:00:00.000Z`).toISOString() : null;
    const changes = [
        plan !== tenant.plan ? `Plan ${PLAN_LABELS[tenant.plan]} → ${PLAN_LABELS[plan]}` : null,
        seats !== tenant.seats ? `Seats ${tenant.seats} → ${seats}` : null,
        billingTerm !== tenant.billingTerm
            ? `Billing ${BILLING_TERM_LABELS[tenant.billingTerm]} → ${BILLING_TERM_LABELS[billingTerm]}`
            : null,
        nextStarts !== tenant.startsAt ? `Start ${tenant.startsAt.slice(0, 10)} → ${startsAt}` : null,
        (nextExpires ?? "") !== (tenant.expiresAt ?? "")
            ? `Expiry ${tenant.expiresAt?.slice(0, 10) ?? "none"} → ${expiresAt || "none"}`
            : null,
        status !== tenant.status ? `Status ${tenant.status} → ${status}` : null,
    ].filter(Boolean) as string[];

    return (
        <div className="max-w-lg space-y-3 text-sm">
            <label className="block text-xs text-muted-foreground">
                Plan
                <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                    value={plan}
                    onChange={(e) => setPlan(e.target.value as TenantPlan)}
                >
                    {TENANT_PLANS.map((p) => (
                        <option key={p} value={p}>
                            {PLAN_LABELS[p]}
                        </option>
                    ))}
                </select>
            </label>
            <label htmlFor="license-seats" className="block text-xs text-muted-foreground">
                Seats
                <Input
                    id="license-seats"
                    className="mt-1"
                    type="number"
                    value={seats}
                    onChange={(e) => setSeats(Number(e.target.value))}
                />
            </label>
            <label className="block text-xs text-muted-foreground">
                Billing term
                <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                    value={billingTerm}
                    onChange={(e) => {
                        const next = e.target.value as BillingTerm;
                        setBillingTerm(next);
                        applyComputedExpiry(startsAt, status, next);
                    }}
                >
                    {BILLING_TERMS.map((term) => (
                        <option key={term} value={term}>
                            {BILLING_TERM_LABELS[term]}
                        </option>
                    ))}
                </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
                <label htmlFor="license-start" className="block text-xs text-muted-foreground">
                    Start
                    <Input
                        id="license-start"
                        className="mt-1"
                        type="date"
                        value={startsAt}
                        onChange={(e) => {
                            setStartsAt(e.target.value);
                            applyComputedExpiry(e.target.value, status, billingTerm);
                        }}
                    />
                </label>
                <label htmlFor="license-expiry" className="block text-xs text-muted-foreground">
                    {status === "trial" ? "Trial expiry" : "Renewal / expiry"}
                    <Input
                        id="license-expiry"
                        className="mt-1"
                        type="date"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                    />
                </label>
            </div>
            <p className="text-xs text-muted-foreground">
                {status === "trial"
                    ? `Trial defaults to 7 days after start (${formatDateOnly(nextExpires)}). Extend still works.`
                    : `${BILLING_TERM_LABELS[billingTerm]} term renews ${formatDateOnly(nextExpires)}.`}
            </p>
            <label className="block text-xs text-muted-foreground">
                Status
                <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                    value={status}
                    onChange={(e) => {
                        const next = e.target.value as Exclude<TenantStatus, "archived">;
                        setStatus(next);
                        applyComputedExpiry(startsAt, next, billingTerm);
                    }}
                >
                    {TENANT_STATUSES.filter((s) => s !== "archived").map((s) => (
                        <option key={s} value={s}>
                            {s}
                        </option>
                    ))}
                </select>
            </label>
            <Input
                placeholder="Reason for this change"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
            />
            <div className="rounded-md bg-muted px-3 py-2 text-xs">
                {changes.length === 0
                    ? "No license fields changed"
                    : changes.map((c) => <div key={c}>{c}</div>)}
            </div>
            {message ? <p className="text-xs text-amber-400">{message}</p> : null}
            <Button
                onClick={() => {
                    if (!reason.trim()) {
                        setMessage("A reason is required");
                        return;
                    }
                    if (changes.length === 0) {
                        setMessage("No license fields changed");
                        return;
                    }
                    setMessage(null);
                    void onSave({
                        plan,
                        seats,
                        billingTerm,
                        startsAt: nextStarts,
                        expiresAt: nextExpires,
                        status,
                        reason,
                    });
                }}
            >
                {busy ? "Saving…" : "Save license"}
            </Button>
        </div>
    );
}

function UsersTab({ users, seats }: { users: TenantUserAccount[]; seats: number }) {
    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                {users.length} account{users.length === 1 ? "" : "s"} count toward {seats} seats.
            </p>
            <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                    <thead className="bg-panel text-[11px] uppercase text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2">Role</th>
                            <th className="px-3 py-2">Last login</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user) => (
                            <tr key={user.id} className="border-t border-border/60">
                                <td className="px-3 py-2">{user.fullName || "—"}</td>
                                <td className="px-3 py-2">{user.email}</td>
                                <td className="px-3 py-2">{ROLE_LABELS[user.role]}</td>
                                <td className="px-3 py-2 text-muted-foreground">
                                    {relativeActivityTime(user.lastLoginAt)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {users.length === 0 ? (
                    <p className="px-3 py-6 text-center text-muted-foreground">No accounts on this tenant.</p>
                ) : null}
            </div>
        </div>
    );
}

function TokensTab({
    tenant,
    ledger,
    onGrant,
}: {
    tenant: TenantRecord;
    ledger: TokenLedgerEntry[];
    onGrant: () => void;
}) {
    const now = useMemo(() => new Date(), []);
    const used = usageThisMonth(ledger, now);
    const burn = monthlyBurnRate(ledger, now);
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-panel p-4">
                    <div className="text-[11px] uppercase text-muted-foreground">Balance</div>
                    <div
                        className={cn(
                            "mt-1 text-3xl font-semibold tabular-nums",
                            tenant.tokenBalance < tenant.tokenThreshold && "text-red-400",
                        )}
                    >
                        {tenant.tokenBalance}
                    </div>
                </div>
                <div className="rounded-lg border border-border bg-panel p-4">
                    <div className="text-[11px] uppercase text-muted-foreground">Used this month</div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums">{used}</div>
                </div>
                <div className="rounded-lg border border-border bg-panel p-4">
                    <div className="text-[11px] uppercase text-muted-foreground">Burn rate / 30d</div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums">{burn}</div>
                </div>
            </div>
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                    Balance is the sum of this ledger. Corrections are adjustment rows — never edit the total
                    directly.
                </p>
                <Button size="sm" onClick={onGrant}>
                    Grant tokens
                </Button>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                    <thead className="bg-panel text-[11px] uppercase text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Amount</th>
                            <th className="px-3 py-2">Balance after</th>
                            <th className="px-3 py-2">By</th>
                            <th className="px-3 py-2">Note</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[...ledger].reverse().map((row) => (
                            <tr key={row.id} className="border-t border-border/60">
                                <td className="px-3 py-2 tabular-nums">{formatAbsolute(row.createdAt)}</td>
                                <td className="px-3 py-2 capitalize">{row.type}</td>
                                <td
                                    className={cn(
                                        "px-3 py-2 tabular-nums",
                                        row.amount > 0 ? "text-emerald-400" : "text-red-400",
                                    )}
                                >
                                    {row.amount > 0 ? `+${row.amount}` : row.amount}
                                </td>
                                <td className="px-3 py-2 tabular-nums">{row.balanceAfter}</td>
                                <td className="px-3 py-2">{row.actorEmail ?? "—"}</td>
                                <td className="px-3 py-2 text-muted-foreground">
                                    {row.reason}
                                    {row.note ? ` · ${row.note}` : ""}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {ledger.length === 0 ? (
                    <p className="px-3 py-6 text-center text-muted-foreground">No ledger rows yet.</p>
                ) : null}
            </div>
        </div>
    );
}

export function AuditTable({ rows }: { rows: AdminAuditEntry[] }) {
    const [openId, setOpenId] = useState<string | null>(null);
    return (
        <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-xs">
                <thead className="bg-panel text-[11px] uppercase text-muted-foreground">
                    <tr>
                        <th className="px-3 py-2">When</th>
                        <th className="px-3 py-2">Actor</th>
                        <th className="px-3 py-2">Tenant</th>
                        <th className="px-3 py-2">Action</th>
                        <th className="px-3 py-2">Reason</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <Fragment key={row.id}>
                            <tr
                                className="cursor-pointer border-t border-border/60 hover:bg-secondary/40"
                                onClick={() => setOpenId(openId === row.id ? null : row.id)}
                            >
                                <td className="px-3 py-2">
                                    <div>{formatAbsolute(row.createdAt)}</div>
                                    <div className="text-muted-foreground">{relativeTime(row.createdAt)}</div>
                                </td>
                                <td className="px-3 py-2">{row.actorEmail ?? "—"}</td>
                                <td className="px-3 py-2">{row.tenantName ?? "—"}</td>
                                <td className="px-3 py-2">{row.action}</td>
                                <td className="px-3 py-2 text-muted-foreground">{row.reason}</td>
                            </tr>
                            {openId === row.id ? (
                                <tr>
                                    <td colSpan={5} className="bg-background px-3 py-3">
                                        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[11px] leading-5">
                                            {JSON.stringify(
                                                { before: row.before, after: row.after },
                                                null,
                                                2,
                                            )}
                                        </pre>
                                    </td>
                                </tr>
                            ) : null}
                        </Fragment>
                    ))}
                </tbody>
            </table>
            {rows.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">No audit entries.</p>
            ) : null}
        </div>
    );
}
