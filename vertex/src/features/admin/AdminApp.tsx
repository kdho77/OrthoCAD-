// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ScrollText, Shield } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import type {
    AdminAuditEntry,
    TenantRecord,
    TenantUserAccount,
    TokenLedgerEntry,
} from "../../../shared/admin/admin-domain";
import { isAdminPath, parseAdminPath, UNDO_WINDOW_MS } from "../../../shared/admin/admin-domain";
import { AdminAuditPage } from "./AdminAuditPage";
import { type AdminModal, AdminModals } from "./AdminModals";
import { AdminTenantDetailPage } from "./AdminTenantDetailPage";
import { AdminTenantsPage } from "./AdminTenantsPage";
import {
    adminDemoNotice,
    createTenant,
    extendTenant,
    fetchAudit,
    fetchAuditCsv,
    fetchTenant,
    fetchTenants,
    grantTokens,
    reactivateTenant,
    surfaceAdminError,
    suspendTenant,
    undoGrant,
    updateLicense,
} from "./admin-client";
import { navigate, showSuperAdminLink, useLocationPath } from "./admin-nav";

interface ToastState {
    message: string;
    undo?: () => Promise<void>;
}

export function AdminApp() {
    const { pathname, search } = useLocationPath();
    const { user, loading } = useAuthStore();
    const route = parseAdminPath(pathname, search);

    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [detail, setDetail] = useState<{
        tenant: TenantRecord;
        ledger: TokenLedgerEntry[];
        audit: AdminAuditEntry[];
        users: TenantUserAccount[];
    } | null>(null);
    const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [modal, setModal] = useState<AdminModal>(null);
    const [busy, setBusy] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState | null>(null);

    const refreshList = useCallback(async () => {
        try {
            setLoadError(null);
            setTenants(await fetchTenants());
            setLoadError(adminDemoNotice());
        } catch (e) {
            setLoadError(surfaceAdminError(e, "Failed to load tenants"));
        }
    }, []);

    const refreshDetail = useCallback(async (id: string) => {
        const data = await fetchTenant(id);
        setDetail(data);
        return data;
    }, []);

    useEffect(() => {
        if (!showSuperAdminLink(user?.role)) return;
        void refreshList();
        if (route.page === "audit") {
            void fetchAudit()
                .then(setAudit)
                .catch((e) => setLoadError(surfaceAdminError(e, "Failed to load audit")));
        }
        if (route.page === "tenant") {
            void refreshDetail(route.id).catch((e) =>
                setLoadError(surfaceAdminError(e, "Failed to load tenant")),
            );
        }
    }, [refreshDetail, refreshList, route, user?.role]);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), UNDO_WINDOW_MS);
        return () => window.clearTimeout(timer);
    }, [toast]);

    if (isSupabaseConfigured()) {
        if (loading) {
            return (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading…
                </div>
            );
        }
        if (!user) return <LoginScreen />;
    }

    if (!showSuperAdminLink(user?.role)) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
                <p>Super admin access required.</p>
                <button type="button" className="text-primary underline" onClick={() => navigate("/")}>
                    Back to CAD
                </button>
            </div>
        );
    }

    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        setModalError(null);
        try {
            await fn();
            setModal(null);
            await refreshList();
            if (route.page === "tenant") await refreshDetail(route.id);
            if (route.page === "audit") setAudit(await fetchAudit());
        } catch (e) {
            setModalError(surfaceAdminError(e, "Action failed"));
        } finally {
            setBusy(false);
        }
    };

    const activeTenant =
        modal && "tenant" in modal ? modal.tenant : route.page === "tenant" ? detail?.tenant : undefined;

    return (
        <div className="flex h-full flex-col bg-background">
            <header className="flex h-12 items-center justify-between bg-[#0b1f3a] px-4 text-white">
                <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-sky-300" />
                    <span className="text-sm font-semibold tracking-wide">Super admin</span>
                    <nav className="ml-4 flex items-center gap-1 text-xs">
                        <NavLink href="/admin" active={route.page === "tenants"}>
                            Tenants
                        </NavLink>
                        <NavLink href="/admin/audit" active={route.page === "audit"}>
                            <ScrollText className="h-3 w-3" /> Audit
                        </NavLink>
                    </nav>
                </div>
                <button
                    type="button"
                    className="text-xs text-white/70 hover:text-white"
                    onClick={() => navigate("/")}
                >
                    Back to CAD
                </button>
            </header>

            {loadError ? (
                <div className="border-b border-yellow-500 bg-yellow-300 px-4 py-2 text-sm font-medium text-yellow-950">
                    {loadError}
                </div>
            ) : null}

            <main className="min-h-0 flex-1 overflow-y-auto">
                {route.page === "tenants" ? (
                    <AdminTenantsPage tenants={tenants} filters={route.filters} onOpen={setModal} />
                ) : null}
                {route.page === "tenant" && detail ? (
                    <AdminTenantDetailPage
                        tenant={detail.tenant}
                        ledger={detail.ledger}
                        audit={detail.audit}
                        users={detail.users}
                        tab={route.tab}
                        busy={busy}
                        onOpen={setModal}
                        onSaveLicense={async (input) => {
                            await run(async () => {
                                await updateLicense({ tenantId: detail.tenant.id, ...input });
                            });
                        }}
                    />
                ) : null}
                {route.page === "audit" ? (
                    <AdminAuditPage rows={audit} tenants={tenants} onExport={() => fetchAuditCsv()} />
                ) : null}
                {route.page === "none" && isAdminPath(pathname) ? (
                    <div className="p-6 text-sm text-muted-foreground">Unknown admin route.</div>
                ) : null}
            </main>

            <AdminModals
                modal={modal}
                busy={busy}
                error={modalError}
                onClose={() => {
                    setModal(null);
                    setModalError(null);
                }}
                onGrant={(input) => {
                    if (!activeTenant) return;
                    void run(async () => {
                        const result = await grantTokens({ tenantId: activeTenant.id, ...input });
                        setToast({
                            message: `Granted ${input.amount} tokens to ${result.tenant.name}`,
                            undo: async () => {
                                await undoGrant({ tenantId: activeTenant.id, amount: input.amount });
                                await refreshList();
                                if (route.page === "tenant") await refreshDetail(route.id);
                                setToast(null);
                            },
                        });
                    });
                }}
                onExtend={(input) => {
                    if (!activeTenant) return;
                    const previous = activeTenant.expiresAt;
                    void run(async () => {
                        const result = await extendTenant({ tenantId: activeTenant.id, ...input });
                        setToast({
                            message: `Extended ${result.tenant.name} to ${new Date(result.to).toLocaleDateString()}`,
                            undo: async () => {
                                if (previous) {
                                    await extendTenant({
                                        tenantId: activeTenant.id,
                                        expiresAt: previous,
                                        reason: "Undo extend",
                                    });
                                }
                                await refreshList();
                                if (route.page === "tenant") await refreshDetail(route.id);
                                setToast(null);
                            },
                        });
                    });
                }}
                onSuspend={(input) => {
                    if (!activeTenant) return;
                    void run(async () => {
                        const tenant = await suspendTenant({ tenantId: activeTenant.id, ...input });
                        setToast({
                            message: `Suspended ${tenant.name}`,
                            undo: async () => {
                                await reactivateTenant({ tenantId: activeTenant.id, reason: "Undo suspend" });
                                await refreshList();
                                if (route.page === "tenant") await refreshDetail(route.id);
                                setToast(null);
                            },
                        });
                    });
                }}
                onReactivate={(reason) => {
                    if (!activeTenant) return;
                    void run(async () => {
                        const tenant = await reactivateTenant({ tenantId: activeTenant.id, reason });
                        setToast({
                            message: `Reactivated ${tenant.name}`,
                            undo: async () => {
                                await suspendTenant({
                                    tenantId: activeTenant.id,
                                    reason: "Undo reactivate",
                                    confirmName: tenant.name,
                                });
                                await refreshList();
                                if (route.page === "tenant") await refreshDetail(route.id);
                                setToast(null);
                            },
                        });
                    });
                }}
                onCreate={(input) => {
                    void run(async () => {
                        const { tenant, admin } = await createTenant(input);
                        if (admin.inviteLink) {
                            try {
                                await navigator.clipboard.writeText(admin.inviteLink);
                            } catch {
                                // Clipboard is optional; temp password / link still show in the toast.
                            }
                        }
                        const bits = [`Created ${tenant.name}`, `admin ${admin.email}`];
                        if (admin.tempPassword) bits.push(`temp password ${admin.tempPassword}`);
                        if (admin.inviteLink) bits.push("invite link copied");
                        setToast({ message: bits.join(" · ") });
                        navigate(`/admin/tenants/${tenant.id}?tab=users`);
                    });
                }}
            />

            {toast ? (
                <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-panel px-3 py-2 text-sm shadow-2xl">
                    <span>{toast.message}</span>
                    {toast.undo ? (
                        <button
                            type="button"
                            className="text-xs font-medium text-primary"
                            onClick={() => void toast.undo?.()}
                        >
                            Undo
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={() => navigate(href)}
            className={cn(
                "flex items-center gap-1 rounded px-2 py-1",
                active ? "bg-white/10 text-white" : "text-white/70 hover:text-white",
            )}
        >
            {children}
        </button>
    );
}
