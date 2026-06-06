import { Coins, KeyRound, ScrollText, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import type { License } from "@/types";

interface AdminPortalProps {
    open: boolean;
    onClose: () => void;
}

// Super Admin Portal (/admin). Functional offline against the local session;
// when the API is configured it calls the server `admin.*` procedures.
export function AdminPortal({ open, onClose }: AdminPortalProps) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
            <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-panel shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold">Super Admin Portal</h2>
                    <Button size="icon" variant="ghost" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <Tabs defaultValue="tokens" className="flex flex-1 flex-col overflow-hidden">
                    <div className="border-b border-border px-4 py-2">
                        <TabsList>
                            <TabsTrigger value="tokens">
                                <Coins className="mr-1 h-3.5 w-3.5" /> Tokens
                            </TabsTrigger>
                            <TabsTrigger value="licenses">
                                <KeyRound className="mr-1 h-3.5 w-3.5" /> Licenses
                            </TabsTrigger>
                            <TabsTrigger value="audit">
                                <ScrollText className="mr-1 h-3.5 w-3.5" /> Audit Log
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 text-sm">
                        <TabsContent value="tokens">
                            <TokensTab />
                        </TabsContent>
                        <TabsContent value="licenses">
                            <LicensesTab />
                        </TabsContent>
                        <TabsContent value="audit">
                            <AuditTab />
                        </TabsContent>
                    </div>
                </Tabs>
            </div>
        </div>
    );
}

function TokensTab() {
    const { user, setUser } = useAuthStore();
    const record = useAuditStore((s) => s.record);
    const [amount, setAmount] = useState(50);
    const [msg, setMsg] = useState<string | null>(null);

    const grant = async () => {
        if (!user) return;
        if (isApiConfigured()) {
            try {
                const res = await trpc.admin.grantTokens.mutate({ userId: user.id, amount });
                setUser({ ...user, tokenBalance: res.balance });
            } catch (e) {
                setMsg(e instanceof Error ? e.message : "Grant failed");
                return;
            }
        } else {
            setUser({ ...user, tokenBalance: Math.max(0, user.tokenBalance + amount) });
        }
        record("tokens_granted", `${amount >= 0 ? "+" : ""}${amount} → ${user.email}`);
        setMsg(`Granted ${amount} tokens to ${user.email}`);
    };

    return (
        <div className="max-w-md space-y-3">
            <div className="rounded-md border border-border bg-background/50 p-3">
                <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">User</span>
                    <span>{user?.email}</span>
                </div>
                <div className="mt-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Role</span>
                    <span>{user?.role}</span>
                </div>
                <div className="mt-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Balance</span>
                    <span className="tabular-nums">{user?.tokenBalance ?? 0}</span>
                </div>
            </div>
            <div className="flex items-end gap-2">
                <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Grant amount (bulk)</label>
                    <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                </div>
                <Button onClick={grant}>Add tokens</Button>
            </div>
            <div className="flex gap-1">
                {[50, 100, 500].map((n) => (
                    <Button key={n} size="sm" variant="secondary" onClick={() => setAmount(n)}>
                        {n}
                    </Button>
                ))}
            </div>
            {msg ? <p className="text-xs text-emerald-400">{msg}</p> : null}
        </div>
    );
}

function LicensesTab() {
    const { user, license, setLicense } = useAuthStore();
    const record = useAuditStore((s) => s.record);

    const renew = () => {
        const next: License = {
            id: license?.id ?? crypto.randomUUID(),
            type: license?.type ?? "yearly",
            status: "active",
            seats: license?.seats ?? 1,
            startsAt: license?.startsAt ?? new Date().toISOString(),
            expiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
        };
        setLicense(next);
        record("license_renewed", `${next.type} → ${user?.email}`);
    };
    const revoke = () => {
        if (!license) return;
        setLicense({ ...license, status: "revoked" });
        record("license_revoked", `${license.type} → ${user?.email}`);
    };

    return (
        <div className="max-w-md space-y-3">
            <div className="rounded-md border border-border bg-background/50 p-3 text-xs">
                <Row label="Type" value={license?.type ?? "—"} />
                <Row label="Status" value={license?.status ?? "none"} />
                <Row label="Seats" value={String(license?.seats ?? 0)} />
                <Row
                    label="Expires"
                    value={license?.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : "—"}
                />
            </div>
            <div className="flex gap-2">
                <Button onClick={renew}>Create / Renew (1y)</Button>
                <Button
                    variant="destructive"
                    onClick={revoke}
                    disabled={!license || license.status === "revoked"}
                >
                    Revoke
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">
                Monthly / yearly / per-seat licenses with expiration are managed server-side via{" "}
                <code className="text-primary">admin.createLicense</code> when the API is connected.
            </p>
        </div>
    );
}

function AuditTab() {
    const entries = useAuditStore((s) => s.entries);
    return (
        <div className="space-y-1">
            {entries.length === 0 ? (
                <p className="text-xs text-muted-foreground">No session activity yet.</p>
            ) : (
                entries.map((e) => (
                    <div
                        key={e.id}
                        className="flex items-center justify-between rounded border border-border/50 px-2 py-1.5 text-xs"
                    >
                        <span className="flex items-center gap-2">
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{e.action}</span>
                            {e.detail}
                        </span>
                        <span className="text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
                    </div>
                ))
            )}
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground">{label}</span>
            <span className="capitalize">{value}</span>
        </div>
    );
}
