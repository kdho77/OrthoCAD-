// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { cn } from "@/lib/utils";
import {
    displayTenantStatus,
    expiryTone,
    formatDateOnly,
    PLAN_LABELS,
    STATUS_LABELS,
    type TenantRecord,
    type TenantStatus,
} from "../../../shared/admin/admin-domain";

const STATUS_CLASS: Record<TenantStatus, string> = {
    active: "bg-emerald-500/15 text-emerald-300",
    trial: "bg-sky-500/15 text-sky-300",
    suspended: "bg-amber-500/15 text-amber-300",
    expired: "bg-red-500/15 text-red-300",
    archived: "bg-muted text-muted-foreground",
};

export function StatusPill({ tenant, now }: { tenant: TenantRecord; now?: Date }) {
    const status = displayTenantStatus(tenant, now);
    return (
        <span
            className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                STATUS_CLASS[status],
            )}
        >
            {STATUS_LABELS[status]}
        </span>
    );
}

export function PlanLabel({ plan }: { plan: TenantRecord["plan"] }) {
    return <span>{PLAN_LABELS[plan]}</span>;
}

export function SeatsBar({ used, total }: { used: number; total: number }) {
    const pct = Math.min(100, Math.round((used / Math.max(1, total)) * 100));
    return (
        <div className="flex min-w-[88px] items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular-nums text-[11px] text-muted-foreground">
                {used}/{total}
            </span>
        </div>
    );
}

export function ExpiryCell({ iso, now }: { iso: string | null; now?: Date }) {
    const tone = expiryTone(iso, now);
    return (
        <span
            className={cn(
                "tabular-nums text-xs",
                tone === "red" && "text-red-400",
                tone === "amber" && "text-amber-300",
            )}
        >
            {formatDateOnly(iso)}
        </span>
    );
}

export function TokenCell({ balance, threshold }: { balance: number; threshold: number }) {
    const low = balance < threshold;
    return <span className={cn("tabular-nums text-xs", low && "text-red-400")}>{balance}</span>;
}
