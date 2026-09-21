import { Bookmark, Layers, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    type CorrectionPresetPayload,
    captureCorrectionPresetFromDesign,
} from "@/lib/clinical/correction-presets";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { useCorrectionPresetStore } from "@/stores/correction-preset-store";
import { useDesignStore } from "@/stores/design-store";

type ApplyMode = "replace" | "merge";

export function CorrectionPresetsPanel() {
    const design = useDesignStore((s) => s.design);
    const applyPreset = useDesignStore((s) => s.applyCorrectionPreset);
    const activeFoot = useActiveFootSide();

    const starters = useCorrectionPresetStore((s) => s.listVertexStarters());
    const userPresets = useCorrectionPresetStore((s) => s.listForScope("user"));
    const saveUserPreset = useCorrectionPresetStore((s) => s.saveUserPreset);
    const renamePreset = useCorrectionPresetStore((s) => s.renamePreset);
    const deletePreset = useCorrectionPresetStore((s) => s.deletePreset);

    const [saveOpen, setSaveOpen] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [pendingReplace, setPendingReplace] = useState<{
        name: string;
        payload: CorrectionPresetPayload;
    } | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [pendingRename, setPendingRename] = useState<{ id: string; name: string } | null>(null);
    const [renameValue, setRenameValue] = useState("");

    const captured = useMemo(() => captureCorrectionPresetFromDesign(design), [design]);

    const apply = (payload: CorrectionPresetPayload, mode: ApplyMode, label: string) => {
        if (mode === "replace") {
            setPendingReplace({ name: label, payload });
            return;
        }
        applyPreset(payload, "merge", { activeSide: activeFoot });
    };

    const confirmReplace = () => {
        if (!pendingReplace) return;
        applyPreset(pendingReplace.payload, "replace", { activeSide: activeFoot });
        setPendingReplace(null);
    };

    const saveNameTrimmed = saveName.trim();

    return (
        <div className="mb-3 space-y-2 rounded-md border border-border bg-background/40 p-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Layers className="h-3.5 w-3.5" />
                    Correction presets
                </div>
                <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1 text-[10px]"
                    onClick={() => {
                        setSaveName(`My preset ${userPresets.length + 1}`);
                        setSaveOpen(true);
                    }}
                >
                    <Bookmark className="h-3 w-3" />
                    Save current
                </Button>
            </div>

            <PresetGroup
                title="Vertex starters"
                items={starters.map((p) => ({
                    id: p.id,
                    name: p.name,
                    payload: p.payload,
                    scope: "vertex" as const,
                }))}
                onApply={apply}
            />

            <PresetGroup
                title="My presets"
                emptyCopy="No saved presets yet — adjust Shape corrections and use Save current."
                items={userPresets.map((p) => ({
                    id: p.id,
                    name: p.name,
                    payload: p.payload,
                    scope: "user" as const,
                }))}
                onApply={apply}
                onStartRename={(id, name) => {
                    setRenameValue(name);
                    setPendingRename({ id, name });
                }}
                onDelete={(id) => setPendingDelete(id)}
            />

            <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Save correction preset</DialogTitle>
                    </DialogHeader>
                    <p className="text-xs text-muted-foreground">
                        Saves current corrections, stock elements, thickness, and print hardness defaults.
                    </p>
                    <Input
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        placeholder="Preset name"
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            disabled={!saveNameTrimmed}
                            onClick={() => {
                                const saved = saveUserPreset(saveNameTrimmed, captured);
                                if (saved) setSaveOpen(false);
                            }}
                        >
                            Save
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(pendingReplace)} onOpenChange={(o) => !o && setPendingReplace(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Replace all corrections?</DialogTitle>
                    </DialogHeader>
                    <p className="text-xs text-muted-foreground">
                        Replace will overwrite correction values and stock elements on the active foot
                        {design.corrections.linked ? " (both feet are linked)" : ""}. Merge only updates keys
                        present in the preset.
                    </p>
                    <p className="text-sm font-medium">{pendingReplace?.name}</p>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" size="sm" onClick={() => setPendingReplace(null)}>
                            Cancel
                        </Button>
                        <Button size="sm" variant="destructive" onClick={confirmReplace}>
                            Replace all
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(pendingRename)} onOpenChange={(o) => !o && setPendingRename(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename preset</DialogTitle>
                    </DialogHeader>
                    <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        placeholder="Preset name"
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" size="sm" onClick={() => setPendingRename(null)}>Cancel</Button>
                        <Button
                            size="sm"
                            disabled={!renameValue.trim()}
                            onClick={() => {
                                if (pendingRename && renameValue.trim()) {
                                    renamePreset("user", pendingRename.id, renameValue.trim());
                                    setPendingRename(null);
                                }
                            }}
                        >
                            Rename
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(pendingDelete)} onOpenChange={(o) => !o && setPendingDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete preset?</DialogTitle>
                    </DialogHeader>
                    <p className="text-xs text-muted-foreground">This cannot be undone.</p>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                                if (pendingDelete) deletePreset("user", pendingDelete);
                                setPendingDelete(null);
                            }}
                        >
                            Delete
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function PresetGroup({
    title,
    items,
    emptyCopy,
    onApply,
    onStartRename,
    onDelete,
}: {
    title: string;
    items: { id: string; name: string; payload: CorrectionPresetPayload; scope: "vertex" | "user" }[];
    emptyCopy?: string;
    onApply: (payload: CorrectionPresetPayload, mode: ApplyMode, label: string) => void;
    onStartRename?: (id: string, name: string) => void;
    onDelete?: (id: string) => void;
}) {
    return (
        <div>
            <div className="mb-1 text-[10px] font-medium text-primary/80">{title}</div>
            {items.length === 0 ? (
                <p className="rounded border border-dashed border-border px-2 py-2 text-center text-[10px] text-muted-foreground">
                    {emptyCopy ?? "None"}
                </p>
            ) : (
                <div className="flex flex-col gap-1">
                    {items.map((item) => (
                            <div
                                key={item.id}
                                className="flex items-center gap-1 rounded border border-border bg-panel px-1 py-0.5"
                            >
                                <span className="flex-1 truncate px-1 text-[11px]" title={item.name}>
                                    {item.name}
                                </span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-[10px]"
                                    onClick={() => onApply(item.payload, "merge", item.name)}
                                >
                                    Merge
                                </Button>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 text-[10px]"
                                    onClick={() => onApply(item.payload, "replace", item.name)}
                                >
                                    Replace
                                </Button>
                                {item.scope === "user" && onStartRename && onDelete ? (
                                    <>
                                        <button
                                            type="button"
                                            className="px-1 text-[10px] text-muted-foreground hover:text-foreground"
                                            onClick={() => onStartRename(item.id, item.name)}
                                        >
                                            Rename
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                                            onClick={() => onDelete(item.id)}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </>
                                ) : null}
                            </div>
                    ))}
                </div>
            )}
        </div>
    );
}
