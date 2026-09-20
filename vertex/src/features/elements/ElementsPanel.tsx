import { BookmarkPlus, PenTool, Plus, Save, Scissors, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { ConfirmDeleteTrigger } from "@/components/clinical/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import { SliderField } from "@/components/ui/slider-field";
import {
    deleteCustomAsset,
    placeCustomElement,
    refreshCustomLibrary,
} from "@/features/library/custom-library-service";
import { SaveCustomDialog } from "@/features/library/SaveCustomDialog";
import { elementPlacementSides } from "@/features/clinical/ActiveFootSideBar";
import { elementDisplayName, STOCK_ELEMENTS } from "@/lib/library/manifest";
import { rafThrottle } from "@/lib/performance/throttle";
import { cn } from "@/lib/utils";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { ElementKind, Side } from "@/types";

export function ElementsPanel() {
    const { design, addElement, updateElement, removeElement, selectElement, selectedElementId } =
        useDesignStore();
    const customElements = useCustomLibraryStore((s) => s.customElements);
    const libraryLoading = useCustomLibraryStore((s) => s.loading);
    const editMode = useMeshEditStore((s) => s.editMode);
    const setEditMode = useMeshEditStore((s) => s.setEditMode);
    const setTarget = useMeshEditStore((s) => s.setTarget);
    const selectedVertex = useMeshEditStore((s) => s.selectedVertex);
    const vertexOverrides = useMeshEditStore((s) => s.vertexOverrides);
    const setVertexOverride = useMeshEditStore((s) => s.setVertexOverride);
    const finishTrimLine = useMeshEditStore((s) => s.finishTrimLine);
    const clearTrimLines = useMeshEditStore((s) => s.clearTrimLines);

    const selected = design.elements.find((e) => e.id === selectedElementId) ?? null;
    const elementPreview = usePerformanceStore((s) =>
        selectedElementId ? s.elementPreviews[selectedElementId] : undefined,
    );
    const setElementPreview = usePerformanceStore((s) => s.setElementPreview);
    const clearElementPreview = usePerformanceStore((s) => s.clearElementPreview);

    const displaySelected = useMemo(() => {
        if (!selected) return null;
        if (!elementPreview) return selected;
        return {
            ...selected,
            ...(elementPreview.position ? { position: elementPreview.position } : {}),
            ...(elementPreview.rotationDeg !== undefined ? { rotationDeg: elementPreview.rotationDeg } : {}),
            ...(elementPreview.scale ? { scale: elementPreview.scale } : {}),
            ...(elementPreview.heightMm !== undefined ? { heightMm: elementPreview.heightMm } : {}),
        };
    }, [selected, elementPreview]);

    const previewElementPatch = rafThrottle((id: string, patch: Parameters<typeof setElementPreview>[1]) => {
        setElementPreview(id, patch);
    });

    const [saveOpen, setSaveOpen] = useState(false);

    const placeStockElement = (kind: ElementKind) => {
        for (const side of elementPlacementSides()) {
            addElement(kind, side);
        }
    };

    const placeCustom = (id: string, name: string) => {
        for (const side of elementPlacementSides()) {
            void placeCustomElement(id, name, side);
        }
    };

    useEffect(() => {
        void refreshCustomLibrary();
    }, []);

    const onSelectElement = (id: string) => {
        selectElement(id);
        setTarget({ type: "element", id });
    };

    return (
        <div className="space-y-3">
            <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Stock Library
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                    {STOCK_ELEMENTS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => placeStockElement(item.id as ElementKind)}
                            className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                        >
                            {item.label}
                            <Plus className="h-3 w-3" />
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <BookmarkPlus className="h-3 w-3" />
                        My Custom Library
                    </div>
                    {libraryLoading ? (
                        <span className="text-[10px] text-muted-foreground">Loading…</span>
                    ) : null}
                </div>
                {customElements.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-2 py-2 text-center text-[11px] text-muted-foreground">
                        Save modified elements with &quot;Save as Custom…&quot;
                    </p>
                ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                        {customElements.map((item) => (
                            <div key={item.id} className="flex items-center gap-0.5">
                                <button
                                    type="button"
                                    onClick={() => placeCustom(item.id, item.name)}
                                    className="flex flex-1 items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-2 py-2 text-xs text-foreground hover:border-primary/60"
                                    title={item.category}
                                >
                                    <span className="truncate">{item.name}</span>
                                    <Plus className="h-3 w-3 shrink-0" />
                                </button>
                                <ConfirmDeleteTrigger
                                    title="Delete custom element?"
                                    description={`Remove "${item.name}" from your library?`}
                                    onConfirm={() => void deleteCustomAsset("element", item.id)}
                                    className="rounded border border-border p-1.5 text-muted-foreground hover:text-destructive"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </ConfirmDeleteTrigger>
                            </div>
                        ))}
                    </div>
                )}
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
                        <div
                            key={el.id}
                            className={cn(
                                "flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs",
                                el.id === selectedElementId
                                    ? "border-primary bg-primary/10"
                                    : "border-border bg-background",
                            )}
                        >
                            <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => onSelectElement(el.id)}
                            >
                                {elementDisplayName(el.kind, el.customName)}{" "}
                                <span className="text-muted-foreground">({el.side})</span>
                                {el.kind === "custom" ? (
                                    <span className="ml-1 text-[10px] text-primary">custom</span>
                                ) : null}
                            </button>
                            <ConfirmDeleteTrigger
                                title="Remove element?"
                                description="Remove this element from the design?"
                                onConfirm={() => removeElement(el.id)}
                                className="inline-flex shrink-0"
                            >
                                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                            </ConfirmDeleteTrigger>
                        </div>
                    ))
                )}
            </div>

            {displaySelected ? (
                <div className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                    <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Edit · {elementDisplayName(displaySelected.kind, displaySelected.customName)}
                        </div>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 gap-1 text-[11px]"
                            onClick={() => setSaveOpen(true)}
                        >
                            <Save className="h-3 w-3" />
                            Save as Custom…
                        </Button>
                    </div>

                    <div className="flex gap-1">
                        <Button
                            size="sm"
                            variant={editMode === "trim" ? "default" : "secondary"}
                            className="h-7 flex-1 gap-1 text-[11px]"
                            onClick={() => {
                                setEditMode("trim");
                                setTarget({ type: "element", id: displaySelected.id });
                            }}
                        >
                            <Scissors className="h-3 w-3" />
                            Trim
                        </Button>
                        <Button
                            size="sm"
                            variant={editMode === "vertex" ? "default" : "secondary"}
                            className="h-7 flex-1 gap-1 text-[11px]"
                            onClick={() => {
                                setEditMode("vertex");
                                setTarget({ type: "element", id: displaySelected.id });
                            }}
                        >
                            <PenTool className="h-3 w-3" />
                            Vertex
                        </Button>
                        {editMode === "trim" ? (
                            <>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 text-[11px]"
                                    onClick={finishTrimLine}
                                >
                                    Finish line
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-[11px]"
                                    onClick={clearTrimLines}
                                >
                                    Clear
                                </Button>
                            </>
                        ) : null}
                    </div>

                    <div className="flex gap-1">
                        {(["left", "right"] as Side[]).map((s) => (
                            <Button
                                key={s}
                                size="sm"
                                variant={displaySelected.side === s ? "default" : "secondary"}
                                className="h-7 flex-1"
                                onClick={() => {
                                    updateElement(displaySelected.id, { side: s });
                                    clearElementPreview(displaySelected.id);
                                }}
                            >
                                {s}
                            </Button>
                        ))}
                    </div>
                    <SliderField
                        label="Position X"
                        value={displaySelected.position.x}
                        min={-100}
                        max={100}
                        onPreview={(v) =>
                            previewElementPatch(displaySelected.id, {
                                id: displaySelected.id,
                                position: { ...displaySelected.position, x: v },
                            })
                        }
                        onChange={(v) => {
                            updateElement(displaySelected.id, {
                                position: { ...displaySelected.position, x: v },
                            });
                            clearElementPreview(displaySelected.id);
                        }}
                        unit="mm"
                    />
                    <SliderField
                        label="Position Y"
                        value={displaySelected.position.y}
                        min={-50}
                        max={50}
                        onPreview={(v) =>
                            previewElementPatch(displaySelected.id, {
                                id: displaySelected.id,
                                position: { ...displaySelected.position, y: v },
                            })
                        }
                        onChange={(v) => {
                            updateElement(displaySelected.id, {
                                position: { ...displaySelected.position, y: v },
                            });
                            clearElementPreview(displaySelected.id);
                        }}
                        unit="mm"
                    />
                    <SliderField
                        label="Height"
                        value={displaySelected.heightMm}
                        min={0}
                        max={15}
                        step={0.5}
                        onPreview={(v) =>
                            previewElementPatch(displaySelected.id, { id: displaySelected.id, heightMm: v })
                        }
                        onChange={(v) => {
                            updateElement(displaySelected.id, { heightMm: v });
                            clearElementPreview(displaySelected.id);
                        }}
                        unit="mm"
                    />
                    <SliderField
                        label="Rotation"
                        value={displaySelected.rotationDeg}
                        min={-90}
                        max={90}
                        onPreview={(v) =>
                            previewElementPatch(displaySelected.id, {
                                id: displaySelected.id,
                                rotationDeg: v,
                            })
                        }
                        onChange={(v) => {
                            updateElement(displaySelected.id, { rotationDeg: v });
                            clearElementPreview(displaySelected.id);
                        }}
                        unit="°"
                    />
                    <SliderField
                        label="Scale X"
                        value={displaySelected.scale.x}
                        min={0.25}
                        max={3}
                        step={0.05}
                        onPreview={(v) =>
                            previewElementPatch(displaySelected.id, {
                                id: displaySelected.id,
                                scale: { ...displaySelected.scale, x: v },
                            })
                        }
                        onChange={(v) => {
                            updateElement(displaySelected.id, { scale: { ...displaySelected.scale, x: v } });
                            clearElementPreview(displaySelected.id);
                        }}
                    />
                    <SliderField
                        label="Scale Y"
                        value={displaySelected.scale.y}
                        min={0.25}
                        max={3}
                        step={0.05}
                        onPreview={(v) =>
                            previewElementPatch(displaySelected.id, {
                                id: displaySelected.id,
                                scale: { ...displaySelected.scale, y: v },
                            })
                        }
                        onChange={(v) => {
                            updateElement(displaySelected.id, { scale: { ...displaySelected.scale, y: v } });
                            clearElementPreview(displaySelected.id);
                        }}
                    />

                    {editMode === "vertex" && selectedVertex !== null ? (
                        <SliderField
                            label="Vertex Z offset"
                            value={vertexOverrides.get(selectedVertex)?.z ?? 0}
                            min={-5}
                            max={5}
                            step={0.25}
                            onChange={(v) => {
                                const prev = vertexOverrides.get(selectedVertex);
                                setVertexOverride(
                                    selectedVertex,
                                    new THREE.Vector3(prev?.x ?? 0, prev?.y ?? 0, v),
                                );
                            }}
                            unit="mm"
                        />
                    ) : null}
                </div>
            ) : null}

            <SaveCustomDialog
                open={saveOpen}
                onClose={() => setSaveOpen(false)}
                kind="element"
                defaultName={
                    displaySelected
                        ? `${elementDisplayName(displaySelected.kind, displaySelected.customName)} Custom`
                        : "Custom Element"
                }
                defaultCategory={
                    displaySelected?.kind === "custom" ? "other" : (displaySelected?.kind ?? "other")
                }
                parentStockId={
                    displaySelected?.kind !== "custom"
                        ? displaySelected?.kind
                        : displaySelected?.customElementId
                }
                sourceId={displaySelected?.id}
                side={displaySelected?.side}
            />
        </div>
    );
}
