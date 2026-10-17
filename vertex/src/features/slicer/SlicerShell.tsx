// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { LogIn, LogOut } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DEV_SUPER_ADMIN, isLocalDevServer } from "@/lib/dev-auth";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { SLICER_SESSION_NOTICE } from "./slicer-session";

/**
 * Minimal standalone chrome for /slicer. Brand logo + sign-in/account only.
 * No Clients / Production / Orders, Save, AI Rx, tokens, or CAD status chrome.
 */
export function SlicerShell({ children }: { children: ReactNode }) {
    const { user, loading } = useAuthStore();
    const supabaseOn = isSupabaseConfigured();
    const showAccount = Boolean(user) && !loading;
    const showSignIn = supabaseOn && !user && !loading;
    const [loginOpen, setLoginOpen] = useState(false);
    const [email, setEmail] = useState(DEV_SUPER_ADMIN.email);
    const [password, setPassword] = useState(DEV_SUPER_ADMIN.password);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const signIn = async () => {
        const supabase = getSupabase();
        if (!supabase) return;
        setBusy(true);
        setError(null);
        const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
        if (signError) setError(signError.message);
        else setLoginOpen(false);
        setBusy(false);
    };

    return (
        <div className="flex h-full flex-col">
            <header className="flex h-12 items-center justify-between border-b border-border bg-panel px-3">
                <div className="flex items-center pr-2">
                    <img
                        src="/orthocad-logo.webp"
                        alt="Vertex Orthopedic"
                        className="h-7 w-auto object-contain"
                    />
                </div>
                <div className="flex items-center gap-3">
                    {showSignIn ? (
                        <Button size="sm" variant="outline" onClick={() => setLoginOpen(true)}>
                            <LogIn className="h-3.5 w-3.5" /> Sign in
                        </Button>
                    ) : showAccount ? (
                        <>
                            <div
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-medium"
                                title={user?.email ?? "Account"}
                            >
                                {user?.fullName?.[0]?.toUpperCase() ??
                                    user?.email?.[0]?.toUpperCase() ??
                                    "?"}
                            </div>
                            {supabaseOn ? (
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    title="Sign out"
                                    onClick={() => getSupabase()?.auth.signOut()}
                                >
                                    <LogOut className="h-3.5 w-3.5" />
                                </Button>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </header>
            <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                {SLICER_SESSION_NOTICE}
            </p>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>

            <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Sign in</DialogTitle>
                    </DialogHeader>
                    <p className="mb-3 text-xs text-muted-foreground">
                        Optional. The file still lives only in this session.
                    </p>
                    <form
                        className="space-y-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void signIn();
                        }}
                    >
                        <Input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                        <Input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                        {error ? <p className="text-xs text-destructive">{error}</p> : null}
                        <Button type="submit" className="w-full" disabled={busy}>
                            <LogIn className="h-4 w-4" /> {busy ? "Signing in…" : "Sign in"}
                        </Button>
                    </form>
                    <p className="mt-3 text-center text-[11px] text-muted-foreground">
                        {isLocalDevServer()
                            ? `Dev: ${DEV_SUPER_ADMIN.email}`
                            : "Account is optional for this pay-per-file slicer."}
                    </p>
                </DialogContent>
            </Dialog>
        </div>
    );
}
