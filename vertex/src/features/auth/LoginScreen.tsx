import { LogIn } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";

// Email/password sign-in shown when Supabase is configured and there is no
// active session. Offline/dev mode bypasses this entirely.
export function LoginScreen() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const signIn = async () => {
        const supabase = getSupabase();
        if (!supabase) return;
        setBusy(true);
        setError(null);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
        setBusy(false);
    };

    return (
        <div className="flex h-full items-center justify-center bg-background">
            <div className="w-full max-w-sm rounded-xl border border-border bg-panel p-6 shadow-2xl">
                <div className="mb-5 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-sm font-bold text-primary-foreground">
                        V
                    </div>
                    <div>
                        <div className="text-sm font-semibold">Vertex Orthopedic</div>
                        <div className="text-xs text-muted-foreground">Insole CAD</div>
                    </div>
                </div>
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
                <p className="mt-4 text-center text-[11px] text-muted-foreground">
                    Roles: super_admin · admin · clinician · Managed in Supabase Auth.
                </p>
            </div>
        </div>
    );
}
