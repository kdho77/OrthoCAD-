// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSupabase } from "@/lib/supabase";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { licenseFromMe, mergeSessionIdentity } from "@/features/auth/session-profile";
import { resolveDevRole } from "@/lib/dev-auth";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Session expired mid-work. Keeps the current screen mounted while the user
 * signs back in so design and export state are not torn down.
 */
export function ReAuthModal() {
    const reAuthRequired = useAuthStore((s) => s.reAuthRequired);
    const user = useAuthStore((s) => s.user);
    const emailId = useId();
    const passwordId = useId();
    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    if (!reAuthRequired) return null;

    const email = user?.email ?? "";

    const onSubmit = async () => {
        if (!password.trim()) {
            setError("Enter your password.");
            passwordRef.current?.focus();
            return;
        }
        const supabase = getSupabase();
        if (!supabase) {
            useAuthStore.getState().setReAuthRequired(false);
            return;
        }
        setBusy(true);
        setError(null);
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (signInError || !data.session?.user) {
            setError(signInError?.message ?? "Sign-in failed");
            setBusy(false);
            return;
        }
        const incoming = data.session.user;
        const existing = useAuthStore.getState().user;
        useAuthStore.getState().setUser(
            mergeSessionIdentity(existing, {
                id: incoming.id,
                email: incoming.email ?? email,
                fullName: (incoming.user_metadata?.full_name as string) ?? null,
                role: resolveDevRole(incoming.email, incoming.app_metadata?.role),
            }),
        );
        if (isApiConfigured()) {
            try {
                const me = await trpc.user.me.query();
                useAuthStore.getState().setUser({
                    id: me.id,
                    email: me.email ?? email,
                    fullName: me.fullName ?? existing?.fullName ?? null,
                    role: resolveDevRole(me.email ?? email, me.role),
                    tokenBalance: me.tokenBalance,
                });
                useAuthStore.getState().setLicense(licenseFromMe(me.license));
            } catch (err) {
                console.warn("[auth] re-auth profile reload failed", {
                    at: Date.now(),
                    detail: err instanceof Error ? err.message : "unknown",
                });
            }
        }
        useAuthStore.getState().setReAuthRequired(false);
        setPassword("");
        setBusy(false);
    };

    return (
        <Dialog open>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Sign in again</DialogTitle>
                    <p className="text-sm text-muted-foreground">
                        Your session was interrupted. Sign back in to continue this design and retry export
                        without starting over.
                    </p>
                </DialogHeader>
                <form
                    className="space-y-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void onSubmit();
                    }}
                >
                    <label className="block space-y-1" htmlFor={emailId}>
                        <span className="text-xs text-muted-foreground">Email</span>
                        <input
                            id={emailId}
                            ref={emailRef}
                            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                            value={email}
                            readOnly
                            autoComplete="username"
                        />
                    </label>
                    <label className="block space-y-1" htmlFor={passwordId}>
                        <span className="text-xs text-muted-foreground">Password</span>
                        <input
                            id={passwordId}
                            ref={passwordRef}
                            type="password"
                            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                    </label>
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                    <Button type="submit" className="min-h-11 w-full" disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}
