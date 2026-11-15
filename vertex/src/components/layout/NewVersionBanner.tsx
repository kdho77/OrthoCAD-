// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Button } from "@/components/ui/button";
import { reloadAppAfterSave } from "@/lib/app-version-reload";
import { useAppVersionStore } from "@/lib/app-version-store";

export function NewVersionBanner() {
    const show = useAppVersionStore((s) => s.showUpdateBanner);
    const setReloadError = useAppVersionStore((s) => s.setReloadError);

    if (!show) return null;

    return (
        <div
            role="status"
            data-testid="new-version-banner"
            className="flex items-center justify-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-sm text-foreground"
        >
            <span>A new version of OrthoCAD is available.</span>
            <Button
                type="button"
                size="sm"
                className="min-h-9"
                onClick={() => {
                    void (async () => {
                        const res = await reloadAppAfterSave();
                        if (!res.ok) setReloadError(res.reason);
                    })();
                }}
            >
                Reload
            </Button>
        </div>
    );
}
