// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { MoreHorizontal, Plus, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navigate } from "@/features/admin/admin-nav";
import { cn } from "@/lib/utils";
import {
    matchesTenantFilters,
    PLAN_LABELS,
    relativeActivityTime,
    STATUS_LABELS,
    serializeTenantListSearch,
    sortTenants,
    TENANT_PLANS,
    TENANT_STATUSES,
    type TenantListFilters,
    type TenantPlan,
    type TenantRecord,
    type TenantSortKey,
    type TenantStatus,
    tileCounts,
} from "../../../shared/admin/admin-domain";
import type { AdminModal } from "./AdminModals";
import { ExpiryCell, PlanLabel, SeatsBar, StatusPill, TokenCell } from "./admin-ui";

interface AdminTenantsPageProps {
    tenants: TenantRecord[];
    filters: TenantListFilters;
    onOpen: (modal: AdminModal) => void;
}

const TILES = [
    { id: "active" as const, label: "Active" },
    { id: "expiring" as const, label: "Expiring in 30 days" },
    { id: "suspended" as const, label: "Suspended" },
    { id: "low" as const, label: "Low token balance" },
];

export function AdminTenantsPage({ tenants, filters, onOpen }: AdminTenantsPageProps) {
    const now = useMemo(() => new Date(), []);
    const counts = tileCounts(tenants, now);
    const rows = sortTenants(
        tenants.filter((t) => matchesTenantFilters(t, filters, now)),
        filters.sort,
        filters.dir,
        now,
    );

    const setFilters = (next: TenantListFilters) => {
        navigate(`/admin${serializeTenantListSearch(next)}`);
    };

    const toggleChip = <T extends string>(list: T[], value: T): T[] =>
        list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

    return (
        <div className="mx-auto w-full max-w-6xl space-y-5 p-6">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold">Tenants</h1>
                    <p className="text-xs text-muted-foreground">
                        Customer licenses and token pools. Customers never see this.
                    </p>
                </div>
                <Button size="sm" onClick={() => onOpen({ kind: "create" })}>
                    <Plus className="h-3.5 w-3.5" /> New tenant
                </Button>
            </div>

            <div className="grid grid-cols-4 gap-3">
                {TILES.map((tile) => (
                    <button
                        key={tile.id}
                        type="button"
                        onClick={() =>
                            setFilters({
                                ...filters,
                                tile: filters.tile === tile.id ? null : tile.id,
                                status: [],
                                expiring: false,
                            })
                        }
                        className={cn(
                            "rounded-lg border px-4 py-3 text-left transition-colors",
                            filters.tile === tile.id
                                ? "border-primary bg-primary/10"
                                : "border-border bg-panel hover:border-primary/40",
                        )}
                    >
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {tile.label}
                        </div>
                        <div className="mt-1 text-2xl font-semibold tabular-nums">{counts[tile.id]}</div>
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                    <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        className="pl-7"
                        placeholder="Search tenants"
                        value={filters.q}
                        onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                    />
                </div>
                {TENANT_STATUSES.filter((s) => s !== "archived").map((status) => (
                    <Chip
                        key={status}
                        active={filters.status.includes(status)}
                        onClick={() =>
                            setFilters({
                                ...filters,
                                status: toggleChip(filters.status, status as TenantStatus),
                                tile: null,
                            })
                        }
                    >
                        {STATUS_LABELS[status]}
                    </Chip>
                ))}
                {TENANT_PLANS.map((plan) => (
                    <Chip
                        key={plan}
                        active={filters.plan.includes(plan)}
                        onClick={() =>
                            setFilters({
                                ...filters,
                                plan: toggleChip(filters.plan, plan as TenantPlan),
                                tile: null,
                            })
                        }
                    >
                        {PLAN_LABELS[plan]}
                    </Chip>
                ))}
                <Chip
                    active={filters.expiring}
                    onClick={() => setFilters({ ...filters, expiring: !filters.expiring, tile: null })}
                >
                    Expiring
                </Chip>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                    <thead className="bg-panel text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <SortTh k="name" filters={filters} onSort={setFilters}>
                                Tenant
                            </SortTh>
                            <SortTh k="plan" filters={filters} onSort={setFilters}>
                                Plan
                            </SortTh>
                            <SortTh k="seats" filters={filters} onSort={setFilters}>
                                Seats
                            </SortTh>
                            <SortTh k="expiry" filters={filters} onSort={setFilters}>
                                Expiry
                            </SortTh>
                            <SortTh k="status" filters={filters} onSort={setFilters}>
                                Status
                            </SortTh>
                            <SortTh k="tokens" filters={filters} onSort={setFilters}>
                                Tokens
                            </SortTh>
                            <SortTh k="activity" filters={filters} onSort={setFilters}>
                                Last activity
                            </SortTh>
                            <th className="w-10 px-2 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={8}
                                    className="px-3 py-8 text-center text-xs text-muted-foreground"
                                >
                                    No tenants match these filters.
                                </td>
                            </tr>
                        ) : (
                            rows.map((tenant) => (
                                <TenantRow key={tenant.id} tenant={tenant} now={now} onOpen={onOpen} />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "rounded-full border px-2.5 py-1 text-[11px]",
                active
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
            )}
        >
            {children}
        </button>
    );
}

function SortTh({
    k,
    filters,
    onSort,
    children,
}: {
    k: TenantSortKey;
    filters: TenantListFilters;
    onSort: (next: TenantListFilters) => void;
    children: ReactNode;
}) {
    const active = filters.sort === k;
    return (
        <th className="px-3 py-2">
            <button
                type="button"
                className="hover:text-foreground"
                onClick={() =>
                    onSort({
                        ...filters,
                        sort: k,
                        dir: active && filters.dir === "asc" ? "desc" : "asc",
                    })
                }
            >
                {children}
                {active ? (filters.dir === "asc" ? " ↑" : " ↓") : ""}
            </button>
        </th>
    );
}

function TenantRow({
    tenant,
    now,
    onOpen,
}: {
    tenant: TenantRecord;
    now: Date;
    onOpen: (modal: AdminModal) => void;
}) {
    const [menu, setMenu] = useState(false);
    const suspended = tenant.status === "suspended";
    return (
        <tr
            className="cursor-pointer border-t border-border/60 hover:bg-secondary/40"
            onClick={() => navigate(`/admin/tenants/${tenant.id}`)}
        >
            <td className="px-3 py-2.5 font-medium">{tenant.name}</td>
            <td className="px-3 py-2.5 text-xs">
                <PlanLabel plan={tenant.plan} />
            </td>
            <td className="px-3 py-2.5">
                <SeatsBar used={tenant.seatsUsed} total={tenant.seats} />
            </td>
            <td className="px-3 py-2.5">
                <ExpiryCell iso={tenant.expiresAt} now={now} />
            </td>
            <td className="px-3 py-2.5">
                <StatusPill tenant={tenant} now={now} />
            </td>
            <td className="px-3 py-2.5">
                <TokenCell balance={tenant.tokenBalance} threshold={tenant.tokenThreshold} />
            </td>
            <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {relativeActivityTime(tenant.lastActivityAt, now)}
            </td>
            <td className="relative px-2 py-2.5">
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                        e.stopPropagation();
                        setMenu((v) => !v);
                    }}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
                {menu ? (
                    <div className="absolute right-2 z-20 w-40 rounded-md border border-border bg-panel py-1 text-xs shadow-xl">
                        <MenuItem
                            onClick={() => {
                                setMenu(false);
                                onOpen({ kind: "extend", tenant });
                            }}
                        >
                            Extend
                        </MenuItem>
                        <MenuItem
                            onClick={() => {
                                setMenu(false);
                                onOpen({ kind: "grant", tenant });
                            }}
                        >
                            Grant tokens
                        </MenuItem>
                        <MenuItem
                            onClick={() => {
                                setMenu(false);
                                onOpen(
                                    suspended ? { kind: "reactivate", tenant } : { kind: "suspend", tenant },
                                );
                            }}
                        >
                            {suspended ? "Reactivate" : "Suspend"}
                        </MenuItem>
                    </div>
                ) : null}
            </td>
        </tr>
    );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-secondary"
            onClick={onClick}
        >
            {children}
        </button>
    );
}
