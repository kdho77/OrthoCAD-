import { useEffect } from "react";
import {
    DEV_SUPER_ADMIN,
    isLocalDevServer,
    offlineLicense,
    offlineUserProfile,
    resolveDevRole,
} from "@/lib/dev-auth";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

// Phase 0 auth foundation.
//
// When Supabase is configured we hydrate the session and map the user's
// `app_metadata.role` to our Role union. When it is NOT configured (local dev /
// preview), we fall back to an offline super_admin so the CAD workspace is fully
// usable. Server-authoritative role, license and token checks are wired through
// tRPC in later phases.

export function useAuthBootstrap() {
    const { setUser, setLicense, setLoading } = useAuthStore();

    useEffect(() => {
        let active = true;

        async function bootstrap() {
            if (!isSupabaseConfigured()) {
                setUser(offlineUserProfile());
                setLicense(offlineLicense());
                setLoading(false);
                return;
            }

            const supabase = getSupabase();
            if (!supabase) {
                setLoading(false);
                return;
            }

            const hydrate = (u: {
                id: string;
                email?: string;
                app_metadata?: Record<string, unknown>;
                user_metadata?: Record<string, unknown>;
            }) => {
                setUser({
                    id: u.id,
                    email: u.email ?? "",
                    fullName: (u.user_metadata?.full_name as string) ?? null,
                    role: resolveDevRole(u.email, u.app_metadata?.role),
                    // Authoritative token balance + license are loaded via user.me.
                    tokenBalance: 0,
                });
            };

            const { data } = await supabase.auth.getSession();
            if (!active) return;
            if (data.session?.user) {
                hydrate(data.session.user);
            } else if (isLocalDevServer()) {
                await supabase.auth.signInWithPassword({
                    email: DEV_SUPER_ADMIN.email,
                    password: DEV_SUPER_ADMIN.password,
                });
            }
            setLoading(false);

            supabase.auth.onAuthStateChange((_event, session) => {
                if (session?.user) {
                    hydrate(session.user);
                } else {
                    setUser(null);
                    setLicense(null);
                }
            });
        }

        void bootstrap();
        return () => {
            active = false;
        };
    }, [setUser, setLicense, setLoading]);
}
