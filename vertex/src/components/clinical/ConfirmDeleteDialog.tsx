// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConfirmDeleteDialogProps {
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    onClose: () => void;
    onConfirm: () => void;
}

export function ConfirmDeleteDialog({
    open,
    title,
    description,
    confirmLabel = "Delete",
    onClose,
    onConfirm,
}: ConfirmDeleteDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <p className="text-xs text-muted-foreground">{description}</p>
                </DialogHeader>
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** Icon button that opens a confirm dialog before running onConfirm. */
export function ConfirmDeleteTrigger({
    title,
    description,
    onConfirm,
    className,
    children,
}: {
    title: string;
    description: string;
    onConfirm: () => void;
    className?: string;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" className={className} onClick={() => setOpen(true)}>
                {children}
            </button>
            <ConfirmDeleteDialog
                open={open}
                title={title}
                description={description}
                onClose={() => setOpen(false)}
                onConfirm={onConfirm}
            />
        </>
    );
}
