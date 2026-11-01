// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useRef, useState } from "react";
import { IDLE_LOGOUT_MS, IDLE_WARNING_MS, inactivityPhase } from "../../../shared/client-files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { navigate } from "@/features/admin/admin-nav";
import { getSupabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export function InactivityGuard() {
    const last = useRef(Date.now());
    const [now, setNow] = useState(() => Date.now());
    const signedOut = useRef(false);

    useEffect(() => {
        const mark = () => {
            last.current = Date.now();
        };
        const events = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
        for (const event of events) window.addEventListener(event, mark, { passive: true });
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => {
            for (const event of events) window.removeEventListener(event, mark);
            window.clearInterval(timer);
        };
    }, []);

    const idle = now - last.current;
    const phase = inactivityPhase(idle);

    useEffect(() => {
        if (phase !== "logout" || signedOut.current) return;
        signedOut.current = true;
        const supabase = getSupabase();
        if (supabase) void supabase.auth.signOut();
        useAuthStore.getState().setUser(null);
        useAuthStore.getState().setLicense(null);
        navigate("/");
    }, [phase]);

    if (phase !== "warning") return null;
    const seconds = Math.max(0, Math.ceil((IDLE_LOGOUT_MS - idle) / 1000));

    return (
        <Dialog open>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Still there?</DialogTitle>
                    <p className="text-sm text-muted-foreground">You will be signed out in {seconds}s.</p>
                </DialogHeader>
                <div className="flex justify-end">
                    <Button
                        type="button"
                        className="min-h-11"
                        onClick={() => {
                            last.current = Date.now();
                            setNow(Date.now());
                        }}
                    >
                        Stay signed in
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export const INACTIVITY_WARNING_AT = IDLE_WARNING_MS;
