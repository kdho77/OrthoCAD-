import { Coins, Shield, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import { navigate, showSuperAdminLink } from "@/features/admin/admin-nav";
import { CLIENT_LIST_PATH } from "@/features/clients/client-list-nav";
import { SaveControl } from "@/features/designs/SaveControl";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const NAV = ["Clients", "Production"] as const;
type NavItem = (typeof NAV)[number];

const HEADER_LOGO_SRC = "/brand/orthocad-logo-header.png";

interface TopNavProps {
    active: NavItem;
    onNavigate: (item: NavItem) => void;
    onOpenPrescription: () => void;
    /** Replaces the workspace links. Used by the design editor breadcrumb. */
    leading?: ReactNode;
    /** When set (design editor), use guarded navigation e.g. unsaved-changes prompt. */
    onLogoNavigate?: () => void;
}

export function TopNav({ active, onNavigate, onOpenPrescription, leading, onLogoNavigate }: TopNavProps) {
    const goToClientList = () => {
        if (onLogoNavigate) onLogoNavigate();
        else navigate(CLIENT_LIST_PATH);
    };
    const { user, license } = useAuthStore();

    return (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-2 sm:px-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
                <button
                    type="button"
                    onClick={goToClientList}
                    className="flex shrink-0 items-center rounded pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pr-2"
                    aria-label="Back to client list"
                >
                    <img
                        src={HEADER_LOGO_SRC}
                        alt="OrthoCAD by Vertex Orthopedic Group"
                        className="h-9 w-auto max-w-[7.5rem] object-contain sm:max-w-[8.75rem]"
                        decoding="async"
                    />
                </button>
                {leading ? <div className="min-w-0 flex-1">{leading}</div> : null}
                <nav
                    className={cn(
                        "flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1",
                        leading && "hidden",
                    )}
                >
                    {NAV.map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => onNavigate(item)}
                            className={cn(
                                "shrink-0 whitespace-nowrap rounded px-2 py-1.5 text-sm transition-colors sm:px-3",
                                active === item
                                    ? "bg-secondary text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {item}
                        </button>
                    ))}
                    {showSuperAdminLink(user?.role) ? (
                        <button
                            type="button"
                            onClick={() => navigate("/admin")}
                            className="shrink-0 whitespace-nowrap rounded px-2 py-1.5 text-sm text-sky-300 transition-colors hover:bg-secondary hover:text-sky-200 sm:px-3"
                        >
                            Super admin
                        </button>
                    ) : null}
                </nav>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <div className="hidden md:block">
                    <SaveControl />
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="hidden md:inline-flex"
                    onClick={onOpenPrescription}
                >
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> AI Rx
                </Button>
                <div className="hidden items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs md:flex">
                    <Coins className="h-3.5 w-3.5 text-primary" />
                    <span className="tabular-nums">{user?.tokenBalance ?? 0}</span>
                    <span className="hidden text-muted-foreground xl:inline">tokens</span>
                </div>
                <div className="hidden items-center gap-1.5 text-xs text-muted-foreground xl:flex">
                    <ShieldCheck
                        className={cn(
                            "h-3.5 w-3.5",
                            license?.status === "active" ? "text-emerald-400" : "text-amber-400",
                        )}
                    />
                    {license?.status ?? "no license"}
                </div>
                {showSuperAdminLink(user?.role) ? (
                    <button
                        type="button"
                        onClick={() => navigate("/admin")}
                        className="hidden items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/20 md:flex"
                    >
                        <Shield className="h-3.5 w-3.5" />
                        Super admin
                    </button>
                ) : null}
                <AccountMenu user={user} />
            </div>
        </header>
    );
}

export type { NavItem };
