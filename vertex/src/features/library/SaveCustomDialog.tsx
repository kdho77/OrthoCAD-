// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type SaveTargetKind, saveCustomAsset } from "@/features/library/custom-library-service";
import { SAVE_CUSTOM_TOKEN_COST } from "@/features/licensing/license";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { SIDE_LABELS, type Side } from "@/types";

export type SaveLibrarySide = Side | "both";

export interface SaveCustomDialogProps {
    open: boolean;
    onClose: () => void;
    kind: SaveTargetKind;
    defaultName: string;
    defaultCategory: string;
    parentStockId?: string;
    sourceId?: string;
    side?: SaveLibrarySide;
}

export function SaveCustomDialog({
    open,
    onClose,
    kind,
    defaultName,
    defaultCategory,
    parentStockId,
    sourceId,
    side,
}: SaveCustomDialogProps) {
    const [name, setName] = useState(defaultName);
    const [category, setCategory] = useState(defaultCategory);
    const [saveSide, setSaveSide] = useState<SaveLibrarySide>(side ?? "left");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const tokenBalance = useAuthStore((s) => s.user?.tokenBalance ?? 0);

    useEffect(() => {
        if (open) {
            setName(defaultName);
            setCategory(defaultCategory);
            setSaveSide(side ?? "left");
            setError(null);
        }
    }, [open, defaultName, defaultCategory, side]);

    const onSave = async () => {
        if (!name.trim()) {
            setError("Name is required");
            return;
        }
        setBusy(true);
        setError(null);
        const sides: Side[] = saveSide === "both" ? ["left", "right"] : [saveSide];
        for (const s of sides) {
            const labeled = saveSide === "both" ? `${name.trim()} ${s === "left" ? "L" : "R"}` : name.trim();
            const res = await saveCustomAsset({
                kind,
                name: labeled,
                category: category.trim() || "other",
                parentStockId,
                sourceId,
                side: s,
            });
            if (!res.ok) {
                setBusy(false);
                setError(res.reason ?? "Save failed");
                return;
            }
        }
        setBusy(false);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Save as Custom {kind === "element" ? "Element" : "Prefab"}</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                    Exports the current modified mesh as GLB and adds it to your personal library. Costs{" "}
                    {SAVE_CUSTOM_TOKEN_COST} token
                    {saveSide === "both" ? " per foot" : ""} (balance: {tokenBalance}).
                </p>
                <div className="space-y-2">
                    <div>
                        <p className="mb-1 text-xs text-muted-foreground">Save for</p>
                        <div className="grid grid-cols-3 gap-1">
                            {(["left", "right", "both"] as SaveLibrarySide[]).map((choice) => (
                                <button
                                    key={choice}
                                    type="button"
                                    onClick={() => setSaveSide(choice)}
                                    className={cn(
                                        "rounded border px-1 py-1.5 text-[11px]",
                                        saveSide === choice
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-border text-muted-foreground",
                                    )}
                                >
                                    {choice === "both" ? "Pair" : SIDE_LABELS[choice]}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                        <label htmlFor="save-custom-name">Name</label>
                        <Input
                            id="save-custom-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="mt-1"
                        />
                    </div>
                    <div className="text-xs text-muted-foreground">
                        <label htmlFor="save-custom-category">Category</label>
                        <Input
                            id="save-custom-category"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="mt-1"
                        />
                    </div>
                    {parentStockId ? (
                        <p className="text-[11px] text-muted-foreground">
                            Derived from stock: {parentStockId}
                        </p>
                    ) : null}
                    {error ? <p className="text-xs text-destructive">{error}</p> : null}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button size="sm" onClick={() => void onSave()} disabled={busy}>
                        {busy ? "Saving…" : "Save to Library"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
