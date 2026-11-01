import { Coins, Shield, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import { navigate, showSuperAdminLink } from "@/features/admin/admin-nav";
import { SaveControl } from "@/features/designs/SaveControl";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const NAV = ["Clients", "Production"] as const;
type NavItem = (typeof NAV)[number];

interface TopNavProps {
    active: NavItem;
    onNavigate: (item: NavItem) => void;
    onOpenPrescription: () => void;
    /** Replaces the workspace links. Used by the design editor breadcrumb. */
    leading?: ReactNode;
}

export function TopNav({ active, onNavigate, onOpenPrescription, leading }: TopNavProps) {
    const { user, license } = useAuthStore();

    return (
        <header className="flex min-h-12 items-center justify-between gap-2 overflow-hidden border-b border-border bg-panel px-3">
            <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="flex shrink-0 items-center pr-2">
                    <img
                        src="/orthocad-logo.webp"
                        alt="Vertex Orthopedic"
                        className="h-7 w-auto object-contain"
                    />
                </div>
                {leading ? <div className="min-w-0 flex-1">{leading}</div> : null}
                <nav className={cn("flex items-center gap-1", leading && "hidden")}>
                    {NAV.map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => onNavigate(item)}
                            className={cn(
                                "rounded px-3 py-1.5 text-sm transition-colors",
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
                            className="rounded px-3 py-1.5 text-sm text-sky-300 transition-colors hover:bg-secondary hover:text-sky-200"
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
