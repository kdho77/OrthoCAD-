// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useDesignStore } from "@/stores/design-store";

export function SessionRecoveryDialog() {
    const draft = useDesignStore((s) => s.pendingSessionDesign);
    const resume = useDesignStore((s) => s.resumeSession);
    const startFresh = useDesignStore((s) => s.startFreshSession);
    return (
        <Dialog.Root open={draft !== null}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border border-border bg-panel p-4 shadow-2xl"
                    onEscapeKeyDown={(event) => event.preventDefault()}
                    onInteractOutside={(event) => event.preventDefault()}
                >
                    <Dialog.Title className="text-sm font-semibold">Previous design available</Dialog.Title>
                    <Dialog.Description className="text-sm text-muted-foreground">
                        Resume your previous design with its {draft?.elements.length ?? 0} placed elements, or
                        start with empty insoles. Starting fresh discards the unsaved draft; saved client
                        designs are kept.
                    </Dialog.Description>
                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={startFresh}>
                            Start fresh
                        </Button>
                        <Button onClick={resume}>Resume previous design</Button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
