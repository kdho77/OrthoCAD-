import { Coins, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";

const NAV = ["Clients", "Production", "Orders"] as const;
type NavItem = (typeof NAV)[number];

interface TopNavProps {
    active: NavItem;
    onNavigate: (item: NavItem) => void;
    onOpenAdmin: () => void;
    onOpenPrescription: () => void;
}

export function TopNav({ active, onNavigate, onOpenAdmin, onOpenPrescription }: TopNavProps) {
    const { user, license } = useAuthStore();

    return (
        <header className="flex h-12 items-center justify-between border-b border-border bg-panel px-3">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 pr-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">V</div>
                    <span className="text-sm font-semibold tracking-tight">Vertex Orthopedic</span>
                </div>
                <nav className="flex items-center gap-1">
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
                </nav>
            </div>

            <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" onClick={onOpenPrescription}>
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> AI Rx
                </Button>
                <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs">
                    <Coins className="h-3.5 w-3.5 text-primary" />
                    <span className="tabular-nums">{user?.tokenBalance ?? 0}</span>
                    <span className="text-muted-foreground">tokens</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className={cn("h-3.5 w-3.5", license?.status === "active" ? "text-emerald-400" : "text-amber-400")} />
                    {license?.status ?? "no license"}
                </div>
                {user?.role === "super_admin" ? (
                    <Button size="sm" variant="outline" onClick={onOpenAdmin}>
                        <Users className="h-3.5 w-3.5" /> Admin
                    </Button>
                ) : null}
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                    {user?.fullName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "?"}
                </div>
            </div>
        </header>
    );
}

export type { NavItem };
