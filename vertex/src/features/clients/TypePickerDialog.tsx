// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DesignKind } from "../../../shared/client-files";

interface TypePickerDialogProps {
    open: boolean;
    onClose: () => void;
    onPick: (kind: DesignKind) => void;
}

/** Nothing is preselected. Choosing a card creates the design. */
export function TypePickerDialog({ open, onClose, onPick }: TypePickerDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>New design</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                    <button
                        type="button"
                        data-testid="type-insole"
                        className="min-h-28 rounded-xl border border-border bg-panel p-4 text-left hover:border-primary"
                        onClick={() => onPick("insole")}
                    >
                        <div className="text-sm font-semibold text-primary">Insole</div>
                        <p className="mt-1 text-xs text-muted-foreground">Full-length or 3/4 foot orthotic</p>
                    </button>
                    <button
                        type="button"
                        data-testid="type-afo"
                        className="min-h-28 rounded-xl border border-border bg-panel p-4 text-left hover:border-violet-300/60"
                        onClick={() => onPick("afo")}
                    >
                        <div className="text-sm font-semibold text-violet-200">AFO</div>
                        <p className="mt-1 text-xs text-muted-foreground">Ankle-foot orthosis</p>
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
