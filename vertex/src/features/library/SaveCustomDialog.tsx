import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SAVE_CUSTOM_TOKEN_COST } from "@/features/licensing/license";
import { saveCustomAsset, type SaveTargetKind } from "@/features/library/custom-library-service";
import { useAuthStore } from "@/stores/auth-store";

export interface SaveCustomDialogProps {
    open: boolean;
    onClose: () => void;
    kind: SaveTargetKind;
    defaultName: string;
    defaultCategory: string;
    parentStockId?: string;
    sourceId?: string;
    side?: "left" | "right";
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
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const tokenBalance = useAuthStore((s) => s.user?.tokenBalance ?? 0);

    useEffect(() => {
        if (open) {
            setName(defaultName);
            setCategory(defaultCategory);
            setError(null);
        }
    }, [open, defaultName, defaultCategory]);

    const onSave = async () => {
        if (!name.trim()) {
            setError("Name is required");
            return;
        }
        setBusy(true);
        setError(null);
        const res = await saveCustomAsset({
            kind,
            name: name.trim(),
            category: category.trim() || "other",
            parentStockId,
            sourceId,
            side,
        });
        setBusy(false);
        if (!res.ok) {
            setError(res.reason ?? "Save failed");
            return;
        }
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
                    {SAVE_CUSTOM_TOKEN_COST} token (balance: {tokenBalance}).
                </p>
                <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                        Name
                        <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Category
                        <Input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1" />
                    </label>
                    {parentStockId ? (
                        <p className="text-[11px] text-muted-foreground">Derived from stock: {parentStockId}</p>
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
