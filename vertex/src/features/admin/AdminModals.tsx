// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    BILLING_TERM_LABELS,
    BILLING_TERMS,
    type BillingTerm,
    computeLicenseExpiry,
    extendExpiry,
    formatDateOnly,
    GRANT_REASONS,
    grantPreview,
    isValidAdminEmail,
    PLAN_LABELS,
    TENANT_PLANS,
    type TenantPlan,
    type TenantRecord,
} from "../../../shared/admin/admin-domain";

export type AdminModal =
    | { kind: "grant"; tenant: TenantRecord }
    | { kind: "extend"; tenant: TenantRecord }
    | { kind: "suspend"; tenant: TenantRecord }
    | { kind: "reactivate"; tenant: TenantRecord }
    | { kind: "create" }
    | null;

interface AdminModalsProps {
    modal: AdminModal;
    busy: boolean;
    error: string | null;
    onClose: () => void;
    onGrant: (input: { amount: number; reason: string; note?: string; expiresAt?: string | null }) => void;
    onExtend: (input: { days?: number; expiresAt?: string; reason: string }) => void;
    onSuspend: (input: { reason: string; confirmName: string }) => void;
    onReactivate: (reason: string) => void;
    onCreate: (input: {
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
    }) => void;
}

export function AdminModals(props: AdminModalsProps) {
    const { modal } = props;
    if (!modal) return null;
    return (
        <Dialog open onOpenChange={(open) => (!open ? props.onClose() : undefined)}>
            <DialogContent className="max-w-lg">
                {modal.kind === "grant" ? <GrantForm {...props} tenant={modal.tenant} /> : null}
                {modal.kind === "extend" ? <ExtendForm {...props} tenant={modal.tenant} /> : null}
                {modal.kind === "suspend" ? <SuspendForm {...props} tenant={modal.tenant} /> : null}
                {modal.kind === "reactivate" ? <ReactivateForm {...props} tenant={modal.tenant} /> : null}
                {modal.kind === "create" ? <CreateForm {...props} /> : null}
            </DialogContent>
        </Dialog>
    );
}

function FieldError({ error }: { error: string | null }) {
    if (!error) return null;
    return <p className="text-xs text-destructive">{error}</p>;
}

function GrantForm({ tenant, busy, error, onGrant }: AdminModalsProps & { tenant: TenantRecord }) {
    const [amount, setAmount] = useState(100);
    const [kind, setKind] = useState<(typeof GRANT_REASONS)[number]>("Purchase");
    const [custom, setCustom] = useState("");
    const [note, setNote] = useState("");
    const [expiry, setExpiry] = useState("");
    const reason = kind === "custom" ? custom : kind;
    const preview = grantPreview(tenant.tokenBalance, Number.isFinite(amount) ? amount : 0);
    const blockReason =
        !Number.isInteger(amount) || amount === 0
            ? "Amount must be a non-zero integer"
            : !reason.trim()
              ? "A reason is required"
              : null;

    return (
        <>
            <DialogHeader>
                <DialogTitle>Grant tokens — {tenant.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
                <label htmlFor="grant-amount" className="block text-xs text-muted-foreground">
                    Amount
                    <Input
                        id="grant-amount"
                        className="mt-1"
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(Number(e.target.value))}
                    />
                </label>
                <label className="block text-xs text-muted-foreground">
                    Reason
                    <select
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={kind}
                        onChange={(e) => setKind(e.target.value as (typeof GRANT_REASONS)[number])}
                    >
                        {GRANT_REASONS.map((r) => (
                            <option key={r} value={r}>
                                {r}
                            </option>
                        ))}
                    </select>
                </label>
                {kind === "custom" ? (
                    <Input
                        placeholder="Custom reason"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                    />
                ) : null}
                <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <label htmlFor="grant-expiry" className="block text-xs text-muted-foreground">
                    Optional expiry
                    <Input
                        id="grant-expiry"
                        className="mt-1"
                        type="date"
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                    />
                </label>
                <p className="rounded-md bg-muted px-3 py-2 text-xs">
                    Balance {preview.from} → {preview.to}
                </p>
                <FieldError error={error} />
                {blockReason ? <p className="text-xs text-amber-400">{blockReason}</p> : null}
                <Button
                    className="w-full"
                    onClick={() => {
                        if (blockReason) return;
                        onGrant({
                            amount,
                            reason,
                            note: note || undefined,
                            expiresAt: expiry ? new Date(`${expiry}T00:00:00.000Z`).toISOString() : null,
                        });
                    }}
                >
                    {busy ? "Granting…" : `Grant ${Number.isFinite(amount) ? amount : 0} tokens`}
                </Button>
            </div>
        </>
    );
}

function ExtendForm({ tenant, busy, error, onExtend }: AdminModalsProps & { tenant: TenantRecord }) {
    const [preset, setPreset] = useState<30 | 90 | 365 | "custom">(30);
    const [custom, setCustom] = useState("");
    const [reason, setReason] = useState("Renewal");
    const to = useMemo(() => {
        if (preset === "custom") {
            return custom ? new Date(`${custom}T00:00:00.000Z`).toISOString() : null;
        }
        return extendExpiry(tenant.expiresAt, preset);
    }, [custom, preset, tenant.expiresAt]);
    const blockReason = !reason.trim() ? "A reason is required" : !to ? "Pick a custom expiry date" : null;

    return (
        <>
            <DialogHeader>
                <DialogTitle>Extend license — {tenant.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1">
                    {(
                        [
                            [30, "+30d"],
                            [90, "+90d"],
                            [365, "+1y"],
                            ["custom", "Custom"],
                        ] as const
                    ).map(([value, label]) => (
                        <Button
                            key={label}
                            size="sm"
                            variant={preset === value ? "default" : "secondary"}
                            onClick={() => setPreset(value)}
                        >
                            {label}
                        </Button>
                    ))}
                </div>
                {preset === "custom" ? (
                    <Input type="date" value={custom} onChange={(e) => setCustom(e.target.value)} />
                ) : null}
                <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <p className="rounded-md bg-muted px-3 py-2 text-xs">
                    {tenant.expiresAt ? new Date(tenant.expiresAt).toLocaleDateString() : "none"} →{" "}
                    {to ? new Date(to).toLocaleDateString() : "—"}
                </p>
                <FieldError error={error} />
                {blockReason ? <p className="text-xs text-amber-400">{blockReason}</p> : null}
                <Button
                    className="w-full"
                    onClick={() => {
                        if (blockReason || !to) return;
                        onExtend(preset === "custom" ? { expiresAt: to, reason } : { days: preset, reason });
                    }}
                >
                    {busy ? "Saving…" : "Extend"}
                </Button>
            </div>
        </>
    );
}

function SuspendForm({ tenant, busy, error, onSuspend }: AdminModalsProps & { tenant: TenantRecord }) {
    const [reason, setReason] = useState("");
    const [confirmName, setConfirmName] = useState("");
    const already = tenant.status === "suspended";
    const blockReason = !reason.trim()
        ? "A reason is required"
        : confirmName.trim() !== tenant.name
          ? `Type ${tenant.name} to confirm`
          : null;

    return (
        <>
            <DialogHeader>
                <DialogTitle className="text-destructive">Suspend {tenant.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                    Users on this tenant lose access immediately. CAD files are kept. This does not delete
                    designs, scans, or exports.
                </p>
                {already ? (
                    <p className="text-xs text-amber-400">
                        This tenant is already suspended. Submitting writes another audit row.
                    </p>
                ) : null}
                <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <label htmlFor="suspend-confirm" className="block text-xs text-muted-foreground">
                    Type the tenant name to confirm
                    <Input
                        id="suspend-confirm"
                        className="mt-1"
                        value={confirmName}
                        onChange={(e) => setConfirmName(e.target.value)}
                    />
                </label>
                <FieldError error={error} />
                {blockReason ? <p className="text-xs text-amber-400">{blockReason}</p> : null}
                <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => {
                        if (blockReason) return;
                        onSuspend({ reason, confirmName });
                    }}
                >
                    {busy ? "Suspending…" : "Suspend tenant"}
                </Button>
            </div>
        </>
    );
}

function ReactivateForm({ tenant, busy, error, onReactivate }: AdminModalsProps & { tenant: TenantRecord }) {
    const [reason, setReason] = useState("Reinstated");
    return (
        <>
            <DialogHeader>
                <DialogTitle>Reactivate {tenant.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                    Users regain access with the current plan, seats, and token balance.
                </p>
                <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <FieldError error={error} />
                {!reason.trim() ? <p className="text-xs text-amber-400">A reason is required</p> : null}
                <Button
                    className="w-full"
                    onClick={() => {
                        if (!reason.trim()) return;
                        onReactivate(reason);
                    }}
                >
                    {busy ? "Saving…" : "Reactivate"}
                </Button>
            </div>
        </>
    );
}

function CreateForm({ busy, error, onCreate }: AdminModalsProps) {
    const [name, setName] = useState("");
    const [plan, setPlan] = useState<TenantPlan>("starter");
    const [seats, setSeats] = useState(5);
    const [status, setStatus] = useState<"active" | "trial">("trial");
    const [billingTerm, setBillingTerm] = useState<BillingTerm>("monthly");
    const [adminName, setAdminName] = useState("");
    const [adminEmail, setAdminEmail] = useState("");
    const [tokens, setTokens] = useState(100);
    const [reason, setReason] = useState("New customer");
    const startsAt = useMemo(() => new Date().toISOString(), []);
    const expiresAt = computeLicenseExpiry(startsAt, status, billingTerm);
    const blockReason = !name.trim()
        ? "Name is required"
        : !adminName.trim()
          ? "Admin name is required"
          : !isValidAdminEmail(adminEmail)
            ? "A valid admin email is required"
            : !reason.trim()
              ? "A reason is required"
              : null;
    return (
        <>
            <DialogHeader>
                <DialogTitle>New tenant</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
                <label htmlFor="create-name" className="block text-xs text-muted-foreground">
                    Clinic name
                    <Input
                        id="create-name"
                        className="mt-1"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </label>
                <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs text-muted-foreground">
                        Plan
                        <select
                            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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
                    <label htmlFor="create-seats" className="block text-xs text-muted-foreground">
                        Seats
                        <Input
                            id="create-seats"
                            className="mt-1"
                            type="number"
                            min={1}
                            value={seats}
                            onChange={(e) => setSeats(Number(e.target.value))}
                        />
                    </label>
                </div>
                <div className="block text-xs text-muted-foreground">
                    Status
                    <div className="mt-1 flex gap-2">
                        <Button
                            size="sm"
                            variant={status === "trial" ? "default" : "secondary"}
                            onClick={() => setStatus("trial")}
                        >
                            Trial
                        </Button>
                        <Button
                            size="sm"
                            variant={status === "active" ? "default" : "secondary"}
                            onClick={() => setStatus("active")}
                        >
                            Active
                        </Button>
                    </div>
                </div>
                <label className="block text-xs text-muted-foreground">
                    Billing term
                    <select
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={billingTerm}
                        onChange={(e) => setBillingTerm(e.target.value as BillingTerm)}
                    >
                        {BILLING_TERMS.map((term) => (
                            <option key={term} value={term}>
                                {BILLING_TERM_LABELS[term]}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="rounded-md bg-muted px-3 py-2 text-xs">
                    {status === "trial"
                        ? `Trial expires ${formatDateOnly(expiresAt)} (7 days after start)`
                        : `Renews ${formatDateOnly(expiresAt)} (${BILLING_TERM_LABELS[billingTerm]})`}
                </div>
                <label htmlFor="create-admin-name" className="block text-xs text-muted-foreground">
                    Admin name
                    <Input
                        id="create-admin-name"
                        className="mt-1"
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                    />
                </label>
                <label htmlFor="create-admin-email" className="block text-xs text-muted-foreground">
                    Admin email
                    <Input
                        id="create-admin-email"
                        className="mt-1"
                        type="email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                    />
                </label>
                <label htmlFor="create-tokens" className="block text-xs text-muted-foreground">
                    Initial tokens
                    <Input
                        id="create-tokens"
                        className="mt-1"
                        type="number"
                        value={tokens}
                        onChange={(e) => setTokens(Number(e.target.value))}
                    />
                </label>
                <label htmlFor="create-reason" className="block text-xs text-muted-foreground">
                    Reason
                    <Input
                        id="create-reason"
                        className="mt-1"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                    />
                </label>
                <FieldError error={error} />
                {blockReason ? <p className="text-xs text-amber-400">{blockReason}</p> : null}
                <Button
                    className="w-full"
                    onClick={() => {
                        if (blockReason) return;
                        onCreate({
                            name,
                            plan,
                            seats,
                            status,
                            billingTerm,
                            adminName,
                            adminEmail,
                            expiresAt,
                            initialTokens: tokens || undefined,
                            reason,
                        });
                    }}
                >
                    {busy ? "Creating…" : "Create tenant"}
                </Button>
            </div>
        </>
    );
}
