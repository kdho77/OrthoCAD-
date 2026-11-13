// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { useEffect } from "react";
import {
    consumePendingManualSignOut,
    logAuthRefreshAttempt,
    logAuthStateChange,
    resolveSessionLossAfterFailedRefresh,
    shouldRetrySessionRefresh,
} from "@/features/auth/auth-session-resilience";
import type { SessionIdentity } from "@/features/auth/session-profile";
import {
    licenseFromMe,
    mergeSessionIdentity,
    shouldReloadAuthoritativeProfile,
} from "@/features/auth/session-profile";
import { isExportInProgress } from "@/features/exports/export-service";
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
        let refreshInFlight: Promise<void> | null = null;

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
                const email = me.email ?? existing?.email ?? "";
                setUser({
                    id: me.id,
                    email,
                    fullName: me.fullName ?? existing?.fullName ?? null,
                    role: resolveDevRole(email, me.role),
                    tokenBalance: me.tokenBalance,
                });
                setLicense(licenseFromMe(me.license));
            } catch (err) {
                console.warn("[auth] failed to load user.me profile", err);
            }
        };

        const clearSignedInUser = () => {
            setUser(null);
            setLicense(null);
        };

        let authSubscription: { unsubscribe: () => void } | undefined;

        const handleNullSession = async (
            event: AuthChangeEvent,
            supabase: NonNullable<ReturnType<typeof getSupabase>>,
        ) => {
            const manual = consumePendingManualSignOut();
            const hadUser = Boolean(useAuthStore.getState().user);

            if (manual) {
                clearSignedInUser();
                return;
            }

            if (!shouldRetrySessionRefresh(event, hadUser, manual)) {
                if (!hadUser) clearSignedInUser();
                return;
            }

            if (!refreshInFlight) {
                refreshInFlight = (async () => {
                    const { data, error } = await supabase.auth.refreshSession();
                    if (!active) return;
                    if (data.session?.user) {
                        logAuthRefreshAttempt(event, "ok");
                        applyIdentity(data.session.user);
                        useAuthStore.getState().setReAuthRequired(false);
                        void loadAuthoritativeProfile();
                        return;
                    }
                    logAuthRefreshAttempt(event, "failed", error?.message);
                    const decision = resolveSessionLossAfterFailedRefresh({
                        manualSignOut: false,
                        exportBusy: isExportInProgress(),
                        event,
                        refreshError: error,
                    });
                    if (decision === "reauth") {
                        useAuthStore.getState().setReAuthRequired(true);
                        console.warn("[auth] session lost — re-auth required", { event, at: Date.now() });
                        return;
                    }
                    clearSignedInUser();
                })().finally(() => {
                    refreshInFlight = null;
                });
            }
            await refreshInFlight;
        };

        const handleAuthChange = (event: AuthChangeEvent, session: Session | null) => {
            if (!active) return;
            logAuthStateChange(event, Boolean(session?.user));

            if (session?.user) {
                useAuthStore.getState().setReAuthRequired(false);
                applyIdentity(session.user);
                if (shouldReloadAuthoritativeProfile(event)) {
                    void loadAuthoritativeProfile();
                }
                return;
            }

            const supabase = getSupabase();
            if (!supabase) {
                clearSignedInUser();
                return;
            }
            void handleNullSession(event, supabase);
        };

        async function bootstrap() {
            const forceLogin = new URLSearchParams(window.location.search).has("e2eLogin");
            if (!isSupabaseConfigured()) {
                if (!forceLogin) {
                    setUser(offlineUserProfile());
                    setLicense(offlineLicense());
                }
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
            } else if (isLocalDevServer() && !new URLSearchParams(window.location.search).has("e2eLogin")) {
                await supabase.auth.signInWithPassword({
                    email: DEV_SUPER_ADMIN.email,
                    password: DEV_SUPER_ADMIN.password,
                });
            }
            setLoading(false);

            const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
                handleAuthChange(event, session);
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
