// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect } from "react";
import { refreshAppVersionCheck, VERSION_POLL_MS } from "@/lib/app-version";
import { useAppVersionStore } from "@/lib/app-version-store";

export function AppVersionWatcher() {
    const syncFromCheck = useAppVersionStore((s) => s.syncFromCheck);

    useEffect(() => {
        const controller = new AbortController();

        const run = () => {
            void refreshAppVersionCheck(controller.signal).then(syncFromCheck);
        };

        run();
        const interval = window.setInterval(run, VERSION_POLL_MS);

        const onFocus = () => run();
        const onVisibility = () => {
            if (document.visibilityState === "visible") run();
        };

        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            controller.abort();
            window.clearInterval(interval);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [syncFromCheck]);

    return null;
}
