// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reloadAppAfterSave } from "@/lib/app-version-reload";
import { useAppVersionStore } from "@/lib/app-version-store";

export function StaleBuildExportDialog() {
    const open = useAppVersionStore((s) => s.exportBlockedModalOpen);
    const reloadError = useAppVersionStore((s) => s.reloadError);
    const close = useAppVersionStore((s) => s.closeExportBlockedModal);
    const setReloadError = useAppVersionStore((s) => s.setReloadError);

    return (
        <Dialog open={open} onOpenChange={(next) => !next && close()}>
            <DialogContent className="max-w-sm" data-testid="stale-build-export-dialog">
                <DialogHeader>
                    <DialogTitle>Update available</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                    OrthoCAD was updated. Reload to export with the latest version.
                </p>
                {reloadError ? (
                    <p className="text-sm text-destructive" data-testid="stale-reload-error">
                        {reloadError}
                    </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="secondary" className="min-h-11" onClick={() => close()}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        className="min-h-11"
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
            </DialogContent>
        </Dialog>
    );
}
