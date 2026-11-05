import { PanelHeading } from "@/components/clinical/PanelHeading";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { buildTrimPresetCurve, TRIM_PRESET_LABELS } from "@/lib/geometry/trim-presets";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { leaveOutlineEdit, useMeshEditStore } from "@/stores/mesh-edit-store";
import type { TrimPresetId } from "@/types";

const PRESETS: Exclude<TrimPresetId, "custom">[] = ["full", "sulcus", "met_head"];

const TRIM_INFO =
    "Distal AP cut at clinical landmark (±3 mm). Preview in the viewer, then Done or Cancel. " +
    "When L+R are linked, confirming applies the same outline to both feet.";

export function TrimPresetsPanel() {
    const design = useDesignStore((s) => s.design);
    const activeFoot = useActiveFootSide();
    const linked = design.corrections.linked;

    const beginTrimlineEditWithDraft = useMeshEditStore((s) => s.beginTrimlineEditWithDraft);
    const getTrimlineForSide = useMeshEditStore((s) => s.getTrimlineForSide);

    const layout = insoleLayoutFromDesign(design);
    const activePreset = design.trimPreset?.[activeFoot];

    const previewPreset = (preset: Exclude<TrimPresetId, "custom">) => {
        const mode = useMeshEditStore.getState().editMode;
        if (mode === "edit-bottom-pattern" && !leaveOutlineEdit({ promptIfDirty: true })) return;
        const base = getTrimlineForSide(activeFoot);
        const draft = buildTrimPresetCurve(preset, {
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
            baseCurve: base,
        });
        beginTrimlineEditWithDraft(activeFoot, draft, preset);
    };

    return (
        <div className="mb-3 space-y-2 rounded-md border border-border bg-background/40 p-2">
            <PanelHeading title="Top trim" info={TRIM_INFO} />

            {!linked && activePreset ? (
                <p className="text-[10px] text-muted-foreground">
                    {TRIM_PRESET_LABELS[activePreset] ?? "Custom"}
                </p>
            ) : null}

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
                <p className="text-[10px] text-amber-600">Custom outline</p>
            ) : null}
        </div>
    );
}
