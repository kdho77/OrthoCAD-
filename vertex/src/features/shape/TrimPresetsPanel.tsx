import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { buildTrimPresetCurve, TRIM_PRESET_LABELS } from "@/lib/geometry/trim-presets";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { TrimPresetId } from "@/types";

const PRESETS: Exclude<TrimPresetId, "custom">[] = ["full", "sulcus", "met_head"];

export function TrimPresetsPanel() {
    const design = useDesignStore((s) => s.design);
    const activeFoot = useActiveFootSide();
    const linked = design.corrections.linked;

    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
    const beginTrimlineEditWithDraft = useMeshEditStore((s) => s.beginTrimlineEditWithDraft);
    const confirmTrimlineEdit = useMeshEditStore((s) => s.confirmTrimlineEdit);
    const cancelTrimlineEdit = useMeshEditStore((s) => s.cancelTrimlineEdit);
    const getTrimlineForSide = useMeshEditStore((s) => s.getTrimlineForSide);

    const layout = insoleLayoutFromDesign(design);
    const activePreset = design.trimPreset?.[activeFoot];

    const previewPreset = (preset: Exclude<TrimPresetId, "custom">) => {
        const base = getTrimlineForSide(activeFoot);
        const draft = buildTrimPresetCurve(preset, {
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
            baseCurve: base,
        });
        beginTrimlineEditWithDraft(activeFoot, draft, preset);
    };

    const sessionForFoot = trimlineEdit?.side === activeFoot || (linked && trimlineEdit);

    return (
        <div className="mb-3 space-y-2 rounded-md border border-border bg-background/40 p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Top trim presets
            </div>
            <p className="text-[10px] text-muted-foreground">
                Distal AP cut at clinical landmark (±3 mm). Preview, then confirm or cancel.
            </p>

            {linked ? (
                <p className="text-[10px] text-primary/80">Linked L+R — confirm applies the same outline to both feet.</p>
            ) : (
                <p className="text-[10px] text-muted-foreground">
                    Active foot: <span className="text-foreground">{activeFoot}</span>
                    {activePreset ? ` · ${TRIM_PRESET_LABELS[activePreset] ?? "Custom"}` : ""}
                </p>
            )}

            <div className="grid grid-cols-3 gap-1.5">
                {PRESETS.map((id) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => previewPreset(id)}
                        className={cn(
                            "rounded-md border px-2 py-2 text-[11px] transition-colors",
                            activePreset === id
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-background text-muted-foreground hover:border-primary/50",
                        )}
                    >
                        {TRIM_PRESET_LABELS[id]}
                    </button>
                ))}
            </div>

            {activePreset === "custom" || (!activePreset && design.trimlines?.[activeFoot]) ? (
                <p className="text-[10px] text-amber-600">
                    Custom outline — preset label cleared until you confirm a named preset.
                </p>
            ) : null}

            {trimlineEdit && sessionForFoot ? (
                <div className="flex gap-1 border-t border-border pt-2">
                    <Button size="sm" className="h-7 flex-1 gap-1 text-[11px]" onClick={confirmTrimlineEdit}>
                        <Check className="h-3 w-3" /> Confirm
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 flex-1 gap-1 text-[11px]"
                        onClick={cancelTrimlineEdit}
                    >
                        <X className="h-3 w-3" /> Cancel
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
