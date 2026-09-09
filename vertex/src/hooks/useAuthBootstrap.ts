// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect } from "react";
import type { SessionIdentity } from "@/features/auth/session-profile";
import {
    licenseFromMe,
    mergeSessionIdentity,
    shouldReloadAuthoritativeProfile,
} from "@/features/auth/session-profile";
import {
    DEV_SUPER_ADMIN,
    isLocalDevServer,
    offlineLicense,
    offlineUserProfile,
    resolveDevRole,
} from "@/lib/dev-auth";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuthStore } from "@/stores/auth-store";

// Phase 0 auth foundation.
//
// When Supabase is configured we hydrate the session and map the user's
// `app_metadata.role` to our Role union. When it is NOT configured (local dev /
// preview), we fall back to an offline super_admin so the CAD workspace is fully
// usable. Token balance and license come from `user.me` — never from a token
// refresh, which used to wipe the displayed balance to 0 mid-export.

export function useAuthBootstrap() {
    const { setUser, setLicense, setLoading } = useAuthStore();

    useEffect(() => {
        let active = true;

        const applyIdentity = (u: {
            id: string;
            email?: string;
            app_metadata?: Record<string, unknown>;
            user_metadata?: Record<string, unknown>;
        }) => {
            const incoming: SessionIdentity = {
                id: u.id,
                email: u.email ?? "",
                fullName: (u.user_metadata?.full_name as string) ?? null,
                role: resolveDevRole(u.email, u.app_metadata?.role),
            };
            const existing = useAuthStore.getState().user;
            if (existing && existing.id !== incoming.id) {
                setLicense(null);
            }
            setUser(mergeSessionIdentity(existing, incoming));
        };

        const loadAuthoritativeProfile = async () => {
            if (!isApiConfigured()) return;
            try {
                const me = await trpc.user.me.query();
                if (!active) return;
                const existing = useAuthStore.getState().user;
                if (existing && existing.id !== me.id) return;
                setUser({
                    id: me.id,
                    email: me.email ?? existing?.email ?? "",
                    fullName: me.fullName ?? existing?.fullName ?? null,
                    role: me.role,
                    tokenBalance: me.tokenBalance,
                });
                setLicense(licenseFromMe(me.license));
            } catch (err) {
                console.warn("[auth] failed to load user.me profile", err);
            }
        };

        let authSubscription: { unsubscribe: () => void } | undefined;

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

            const { data } = await supabase.auth.getSession();
            if (!active) return;
            if (data.session?.user) {
                applyIdentity(data.session.user);
                void loadAuthoritativeProfile();
            } else if (isLocalDevServer()) {
                await supabase.auth.signInWithPassword({
                    email: DEV_SUPER_ADMIN.email,
                    password: DEV_SUPER_ADMIN.password,
                });
            }
            setLoading(false);

            const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
                if (!active) return;
                if (session?.user) {
                    applyIdentity(session.user);
                    if (shouldReloadAuthoritativeProfile(event)) {
                        void loadAuthoritativeProfile();
                    }
                } else {
                    setUser(null);
                    setLicense(null);
                }
            });
            if (!active) {
                listener.subscription.unsubscribe();
                return;
            }
            authSubscription = listener.subscription;
        }

        void bootstrap();
        return () => {
            active = false;
            authSubscription?.unsubscribe();
        };
    }, [setUser, setLicense, setLoading]);
}
