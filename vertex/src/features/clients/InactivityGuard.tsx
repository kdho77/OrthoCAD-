// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { navigate } from "@/features/admin/admin-nav";
import {
    inactivityPhaseDuringExport,
    markPendingManualSignOut,
} from "@/features/auth/auth-session-resilience";
import { ReAuthModal } from "@/features/auth/ReAuthModal";
import { isExportInProgress } from "@/features/exports/export-service";
import { getSupabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import {
    crossTabIdleMs,
    IDLE_LOGOUT_MS,
    IDLE_WARNING_MS,
    idleLogoutSignOutOptions,
    inactivityPhase,
    nextSharedActivityTimestamp,
    readStoredActivityMs,
    VERTEX_IDLE_ACTIVITY_CHANNEL,
    VERTEX_LAST_ACTIVITY_KEY,
} from "../../../shared/client-files";

function readSharedActivity(): number | null {
    try {
        return readStoredActivityMs((key) => localStorage.getItem(key));
    } catch {
        return null;
    }
}

function writeSharedActivity(value: number): void {
    try {
        localStorage.setItem(VERTEX_LAST_ACTIVITY_KEY, String(value));
    } catch {
        /* private mode */
    }
}

export function InactivityGuard() {
    const localLast = useRef(Date.now());
    const lastPersist = useRef(0);
    const [now, setNow] = useState(() => Date.now());
    const signedOut = useRef(false);
    const channelRef = useRef<BroadcastChannel | null>(null);

    const bumpClock = () => {
        if (isExportInProgress()) {
            const t = Date.now();
            localLast.current = Math.max(localLast.current, t);
            persistFromLocal();
        }
        setNow(Date.now());
    };

    const persistFromLocal = (force = false) => {
        const stored = readSharedActivity();
        const next = nextSharedActivityTimestamp(
            localLast.current,
            stored,
            lastPersist.current,
            force,
            Date.now(),
        );
        if (!next.persist) return;
        lastPersist.current = next.lastPersistMs;
        writeSharedActivity(next.value);
        channelRef.current?.postMessage({ type: "activity", at: next.value });
    };

    const markActivity = (force = false) => {
        const t = Date.now();
        localLast.current = Math.max(localLast.current, t);
        persistFromLocal(force);
        bumpClock();
    };

    useEffect(() => {
        const shared = readSharedActivity();
        if (shared != null) localLast.current = Math.max(localLast.current, shared);

        let channel: BroadcastChannel | null = null;
        if (typeof BroadcastChannel !== "undefined") {
            channel = new BroadcastChannel(VERTEX_IDLE_ACTIVITY_CHANNEL);
            channelRef.current = channel;
            channel.addEventListener("message", bumpClock);
        }

        const events = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
        const onInput = () => markActivity();
        for (const event of events) window.addEventListener(event, onInput, { passive: true });

        const onStorage = (event: StorageEvent) => {
            if (event.key === VERTEX_LAST_ACTIVITY_KEY) bumpClock();
        };
        window.addEventListener("storage", onStorage);

        const onVisibility = () => {
            if (document.visibilityState === "visible") bumpClock();
        };
        const onFocus = () => bumpClock();
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", onFocus);

        const timer = window.setInterval(bumpClock, 1000);

        return () => {
            for (const event of events) window.removeEventListener(event, onInput);
            window.removeEventListener("storage", onStorage);
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("focus", onFocus);
            window.clearInterval(timer);
            channel?.removeEventListener("message", bumpClock);
            channel?.close();
            channelRef.current = null;
        };
    }, []);

    const idle = crossTabIdleMs(now, localLast.current, readSharedActivity());
    const phase = inactivityPhaseDuringExport(idle, isExportInProgress());

    useEffect(() => {
        if (phase !== "logout" || signedOut.current || isExportInProgress()) return;
        const freshIdle = crossTabIdleMs(Date.now(), localLast.current, readSharedActivity());
        if (inactivityPhase(freshIdle) !== "logout") return;
        signedOut.current = true;
        markPendingManualSignOut();
        const supabase = getSupabase();
        if (supabase) void supabase.auth.signOut(idleLogoutSignOutOptions);
        useAuthStore.getState().setUser(null);
        useAuthStore.getState().setLicense(null);
        navigate("/");
    }, [phase]);

    const seconds = Math.max(0, Math.ceil((IDLE_LOGOUT_MS - idle) / 1000));

    return (
        <>
            <ReAuthModal />
            {phase === "warning" ? (
                <Dialog open>
                    <DialogContent className="max-w-sm">
                        <DialogHeader>
                            <DialogTitle>Still there?</DialogTitle>
                            <p className="text-sm text-muted-foreground">
                                You will be signed out in {seconds}s.
                            </p>
                        </DialogHeader>
                        <div className="flex justify-end">
                            <Button type="button" className="min-h-11" onClick={() => markActivity(true)}>
                                Stay signed in
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            ) : null}
        </>
    );
}

export const INACTIVITY_WARNING_AT = IDLE_WARNING_MS;
