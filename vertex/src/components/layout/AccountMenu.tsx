// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { LogOut, Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navigate, showSuperAdminLink } from "@/features/admin/admin-nav";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { UserProfile } from "@/types";

interface AccountMenuProps {
    user: UserProfile | null;
}

export function AccountMenu({ user }: AccountMenuProps) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const initial = user?.fullName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "?";

    return (
        <div ref={root} className="relative">
            <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-medium"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                title={user?.email ?? "Account"}
            >
                {initial}
            </button>
            {open ? (
                <div
                    role="menu"
                    className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-border bg-panel py-1 text-sm shadow-xl"
                >
                    <div className="border-b border-border px-3 py-2">
                        <div className="truncate text-xs font-medium">{user?.fullName ?? "Signed in"}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
                    </div>
                    {showSuperAdminLink(user?.role) ? (
                        <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary"
                            onClick={() => {
                                setOpen(false);
                                navigate("/admin");
                            }}
                        >
                            <Shield className="h-3.5 w-3.5" /> Super admin
                        </button>
                    ) : null}
                    {isSupabaseConfigured() ? (
                        <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary"
                            onClick={() => {
                                setOpen(false);
                                void getSupabase()?.auth.signOut();
                            }}
                        >
                            <LogOut className="h-3.5 w-3.5" /> Sign out
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
