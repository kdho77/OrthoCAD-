import { useEffect } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { License, Role, UserProfile } from "@/types";

// Phase 0 auth foundation.
//
// When Supabase is configured we hydrate the session and map the user's
// `app_metadata.role` to our Role union. When it is NOT configured (local dev /
// preview), we fall back to an offline super_admin so the CAD workspace is fully
// usable. Server-authoritative role, license and token checks are wired through
// tRPC in later phases.

function offlineUser(): UserProfile {
    return {
        id: "local-dev",
        email: "dev@vertex.local",
        fullName: "Local Developer",
        role: "super_admin",
        tokenBalance: 100,
    };
}

function offlineLicense(): License {
    return {
        id: "local-license",
        type: "yearly",
        status: "active",
        seats: 1,
        startsAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
    };
}

export function useAuthBootstrap() {
    const { setUser, setLicense, setLoading } = useAuthStore();

    useEffect(() => {
        let active = true;

        async function bootstrap() {
            if (!isSupabaseConfigured()) {
                setUser(offlineUser());
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
                    role: (u.app_metadata?.role as Role) ?? "clinician",
                    // Authoritative token balance + license are loaded via user.me.
                    tokenBalance: 0,
                });
            };

            const { data } = await supabase.auth.getSession();
            if (!active) return;
            if (data.session?.user) hydrate(data.session.user);
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
