// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Coins, Shield, ShieldCheck } from "lucide-react";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { navigate, showSuperAdminLink } from "@/features/admin/admin-nav";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

export function DirectoryHeader({ active }: { active: "Clients" | "Production" }) {
    const { user, license } = useAuthStore();
    const itemClass = (on: boolean) =>
        cn(
            "min-h-11 rounded px-3 text-sm",
            on ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
        );

    return (
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-2 sm:px-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <button
                    type="button"
                    onClick={() => navigate("/clients")}
                    className="min-h-11 shrink-0"
                    aria-label="OrthoCAD home"
                >
                    <img src="/orthocad-logo.webp" alt="OrthoCAD" className="h-7 w-auto object-contain" />
                </button>
                <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1">
                    <button
                        type="button"
                        className={cn(
                            itemClass(active === "Clients"),
                            "shrink-0 whitespace-nowrap px-2 sm:px-3",
                        )}
                        onClick={() => navigate("/clients")}
                    >
                        Clients
                    </button>
                    <button
                        type="button"
                        className={cn(
                            itemClass(active === "Production"),
                            "shrink-0 whitespace-nowrap px-2 sm:px-3",
                        )}
                        onClick={() => navigate("/production/queue")}
                    >
                        Production
                    </button>
                    {showSuperAdminLink(user?.role) ? (
                        <button
                            type="button"
                            className="min-h-11 shrink-0 whitespace-nowrap rounded px-2 text-sm text-sky-300 hover:bg-secondary sm:px-3"
                            onClick={() => navigate("/admin")}
                        >
                            Super admin
                        </button>
                    ) : null}
                </nav>
            </div>
            <div className="flex items-center gap-2">
                <div className="hidden items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs sm:flex">
                    <Coins className="h-3.5 w-3.5 text-primary" />
                    <span className="tabular-nums">{user?.tokenBalance ?? 0}</span>
                </div>
                <div className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                    <ShieldCheck
                        className={cn(
                            "h-3.5 w-3.5",
                            license?.status === "active" ? "text-emerald-400" : "text-amber-400",
                        )}
                    />
                </div>
                {showSuperAdminLink(user?.role) ? (
                    <button
                        type="button"
                        className="hidden min-h-11 items-center gap-1 rounded-md border border-sky-500/40 px-2 text-xs text-sky-200 md:inline-flex"
                        onClick={() => navigate("/admin")}
                    >
                        <Shield className="h-3.5 w-3.5" /> Super admin
                    </button>
                ) : null}
                <AccountMenu user={user} />
            </div>
        </header>
    );
}
