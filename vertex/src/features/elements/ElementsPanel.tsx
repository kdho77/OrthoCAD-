import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SliderField } from "@/components/ui/slider-field";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import type { ElementKind, Side } from "@/types";

const LIBRARY: { kind: ElementKind; label: string }[] = [
    { kind: "met_pad", label: "Met Pad" },
    { kind: "met_bar", label: "Met Bar" },
    { kind: "cluffy_wedge", label: "Cluffy Wedge" },
    { kind: "mortons_extension", label: "Morton's Ext." },
    { kind: "reverse_mortons", label: "Rev. Morton's" },
    { kind: "kinetic_wedge", label: "Kinetic Wedge" },
    { kind: "heel_sink", label: "Heel Sink" },
    { kind: "navicular_sink", label: "Navicular Sink" },
];

const LABELS: Record<ElementKind, string> = Object.fromEntries(
    LIBRARY.map((l) => [l.kind, l.label]),
) as Record<ElementKind, string>;

export function ElementsPanel() {
    const { design, addElement, updateElement, removeElement, selectElement, selectedElementId } =
        useDesignStore();
    const selected = design.elements.find((e) => e.id === selectedElementId) ?? null;

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
                {LIBRARY.map((item) => (
                    <button
                        key={item.kind}
                        type="button"
                        onClick={() => addElement(item.kind, "left")}
                        className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                        {item.label}
                        <Plus className="h-3 w-3" />
                    </button>
                ))}
            </div>

            <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Placed
                </div>
                {design.elements.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                        No elements added
                    </p>
                ) : (
                    design.elements.map((el) => (
                        <button
                            key={el.id}
                            type="button"
                            onClick={() => selectElement(el.id)}
                            className={cn(
                                "flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs",
                                el.id === selectedElementId
                                    ? "border-primary bg-primary/10"
                                    : "border-border bg-background",
                            )}
                        >
                            <span>
                                {LABELS[el.kind]} <span className="text-muted-foreground">({el.side})</span>
                            </span>
                            <Trash2
                                className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeElement(el.id);
                                }}
                            />
                        </button>
                    ))
                )}
            </div>

            {selected ? (
                <div className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Edit · {LABELS[selected.kind]}
                    </div>
                    <div className="flex gap-1">
                        {(["left", "right"] as Side[]).map((s) => (
                            <Button
                                key={s}
                                size="sm"
                                variant={selected.side === s ? "default" : "secondary"}
                                className="h-7 flex-1"
                                onClick={() => updateElement(selected.id, { side: s })}
                            >
                                {s}
                            </Button>
                        ))}
                    </div>
                    <SliderField
                        label="Position X"
                        value={selected.position.x}
                        min={-100}
                        max={100}
                        onChange={(v) =>
                            updateElement(selected.id, { position: { ...selected.position, x: v } })
                        }
                        unit="mm"
                    />
                    <SliderField
                        label="Position Y"
                        value={selected.position.y}
                        min={-50}
                        max={50}
                        onChange={(v) =>
                            updateElement(selected.id, { position: { ...selected.position, y: v } })
                        }
                        unit="mm"
                    />
                    <SliderField
                        label="Height"
                        value={selected.heightMm}
                        min={0}
                        max={15}
                        step={0.5}
                        onChange={(v) => updateElement(selected.id, { heightMm: v })}
                        unit="mm"
                    />
                    <SliderField
                        label="Rotation"
                        value={selected.rotationDeg}
                        min={-90}
                        max={90}
                        onChange={(v) => updateElement(selected.id, { rotationDeg: v })}
                        unit="°"
                    />
                    <SliderField
                        label="Scale X"
                        value={selected.scale.x}
                        min={0.25}
                        max={3}
                        step={0.05}
                        onChange={(v) => updateElement(selected.id, { scale: { ...selected.scale, x: v } })}
                    />
                    <SliderField
                        label="Scale Y"
                        value={selected.scale.y}
                        min={0.25}
                        max={3}
                        step={0.05}
                        onChange={(v) => updateElement(selected.id, { scale: { ...selected.scale, y: v } })}
                    />
                </div>
            ) : null}
        </div>
    );
}
