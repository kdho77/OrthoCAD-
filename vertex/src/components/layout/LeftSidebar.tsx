import { BookmarkPlus, FileBox, Footprints, Layers3, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { ScanImport } from "@/features/scans/ScanImport";
import { SaveCustomDialog } from "@/features/library/SaveCustomDialog";
import { deleteCustomAsset, refreshCustomLibrary, selectCustomPrefab } from "@/features/library/custom-library-service";
import { mergePrefabLibrary, STOCK_PREFABS } from "@/lib/library/manifest";
import { useDesignStore } from "@/stores/design-store";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductionMethod, ScanPattern, Side } from "@/types";

const METHODS: { id: ProductionMethod; label: string }[] = [
    { id: "printing_solid", label: "Printing — Solid" },
    { id: "printing_shell", label: "Printing — Shell" },
    { id: "milling_3axis", label: "Milling — 3 Axis" },
];

export function LeftSidebar() {
    const { design, setPattern, setMethod } = useDesignStore();
    const customPrefabs = useCustomLibraryStore((s) => s.customPrefabs);
    const libraryLoading = useCustomLibraryStore((s) => s.loading);
    const setEditMode = useMeshEditStore((s) => s.setEditMode);
    const setTarget = useMeshEditStore((s) => s.setTarget);
    const merged = mergePrefabLibrary(customPrefabs);
    const [saveOpen, setSaveOpen] = useState(false);
    const [saveSide, setSaveSide] = useState<Side>("left");

    useEffect(() => {
        void refreshCustomLibrary();
    }, []);

    const onPattern = (id: string, stock: boolean) => {
        if (stock) {
            setPattern(id as ScanPattern);
            setTarget({ type: "insole", side: "left" });
        } else {
            selectCustomPrefab(id, customPrefabs.find((p) => p.id === id)?.name ?? "Custom Prefab");
            setTarget({ type: "insole", side: "left" });
        }
        setEditMode("transform");
    };

    return (
        <aside className="flex w-56 flex-col gap-4 overflow-y-auto border-r border-border bg-panel p-3">
            <Section icon={<Footprints className="h-3.5 w-3.5" />} title="Pattern">
                <div className="grid grid-cols-2 gap-1.5">
                    {merged.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => onPattern(p.id, p.stock)}
                            className={cn(
                                "rounded-md border px-2 py-2 text-xs transition-colors",
                                (p.stock && design.pattern === p.id) ||
                                    (!p.stock && design.customPrefabId === p.id)
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/50",
                                !p.stock && "border-primary/20",
                            )}
                        >
                            {p.name}
                            {!p.stock ? <span className="mt-0.5 block text-[9px] text-primary">custom</span> : null}
                        </button>
                    ))}
                </div>
                <div className="mt-2 flex gap-1">
                    {(["left", "right"] as Side[]).map((s) => (
                        <Button
                            key={s}
                            size="sm"
                            variant="secondary"
                            className="h-7 flex-1 gap-1 text-[11px]"
                            onClick={() => {
                                setSaveSide(s);
                                setTarget({ type: "insole", side: s });
                                setSaveOpen(true);
                            }}
                        >
                            <Save className="h-3 w-3" />
                            Save {s}…
                        </Button>
                    ))}
                </div>
            </Section>

            <Section icon={<BookmarkPlus className="h-3.5 w-3.5" />} title="My Custom Library">
                {libraryLoading ? (
                    <p className="text-[11px] text-muted-foreground">Loading…</p>
                ) : customPrefabs.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                        Custom prefabs appear here after you save a modified insole/shell.
                    </p>
                ) : (
                    <div className="space-y-1">
                        {customPrefabs.map((p) => (
                            <div key={p.id} className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => onPattern(p.id, false)}
                                    className={cn(
                                        "flex-1 truncate rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-left text-[11px]",
                                        design.customPrefabId === p.id && "border-primary",
                                    )}
                                >
                                    {p.name}
                                </button>
                                <button
                                    type="button"
                                    className="text-[11px] text-muted-foreground hover:text-destructive"
                                    onClick={() => void deleteCustomAsset("prefab", p.id)}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            <Section icon={<Layers3 className="h-3.5 w-3.5" />} title="Production">
                <div className="flex flex-col gap-1.5">
                    {METHODS.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            onClick={() => setMethod(m.id)}
                            className={cn(
                                "rounded-md border px-2 py-2 text-left text-xs transition-colors",
                                design.method === m.id
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/50",
                            )}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            </Section>

            <Section icon={<FileBox className="h-3.5 w-3.5" />} title="Import">
                <ScanImport />
            </Section>

            <SaveCustomDialog
                open={saveOpen}
                onClose={() => setSaveOpen(false)}
                kind="prefab"
                defaultName={`${STOCK_PREFABS.find((p) => p.id === design.pattern)?.label ?? "Insole"} Custom`}
                defaultCategory={design.method === "printing_shell" ? "shell" : "insole"}
                parentStockId={design.pattern}
                sourceId={undefined}
                side={saveSide}
            />
        </aside>
    );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {icon}
                {title}
            </div>
            {children}
        </div>
    );
}
