import {
    BookmarkPlus,
    Check,
    FileBox,
    FlipHorizontal,
    Footprints,
    Layers3,
    Pencil,
    Save,
    Trash2,
    Upload,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    deleteCustomAsset,
    mirrorBaseGlb,
    refreshCustomLibrary,
    renameCustomAsset,
    selectCustomPrefab,
    uploadBaseGlb,
} from "@/features/library/custom-library-service";
import { SaveCustomDialog } from "@/features/library/SaveCustomDialog";
import { ScanImport } from "@/features/scans/ScanImport";
import { mergePrefabLibrary, STOCK_PREFABS } from "@/lib/library/manifest";
import { cn } from "@/lib/utils";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
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
    const uploadRef = useRef<HTMLInputElement>(null);
    const [uploadBusy, setUploadBusy] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [mirroringId, setMirroringId] = useState<string | null>(null);

    useEffect(() => {
        void refreshCustomLibrary();
    }, []);

    const onUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploadBusy(true);
        setUploadError(null);
        try {
            let lastId: string | undefined;
            for (const file of Array.from(files)) {
                const res = await uploadBaseGlb(file);
                if (!res.ok) {
                    setUploadError(res.reason ?? "Upload failed");
                } else {
                    lastId = res.itemId;
                }
            }
            // Load the most recently uploaded base immediately so the user can edit it.
            if (lastId) void onPattern(lastId, false);
        } finally {
            setUploadBusy(false);
            if (uploadRef.current) uploadRef.current.value = "";
        }
    };

    const commitRename = (id: string) => {
        renameCustomAsset("prefab", id, renameValue);
        setRenamingId(null);
    };

    const onMirror = async (id: string) => {
        setMirroringId(id);
        setUploadError(null);
        try {
            const res = await mirrorBaseGlb(id);
            if (!res.ok) setUploadError(res.reason ?? "Mirror failed");
            else if (res.itemId) void onPattern(res.itemId, false);
        } finally {
            setMirroringId(null);
        }
    };

    const onPattern = async (id: string, stock: boolean) => {
        if (stock) {
            // Scan pattern only — the mandatory GLB stock base is never cleared here.
            setPattern(id as ScanPattern);
            setTarget({ type: "insole", side: "left" });
        } else {
            await selectCustomPrefab(id, customPrefabs.find((p) => p.id === id)?.name ?? "Custom Prefab");
            setTarget({ type: "insole", side: "left" });
        }
        setEditMode("transform");
    };

    const usingStockBase =
        design.paired?.leftBase?.source === "stock" || design.paired?.rightBase?.source === "stock" || design.base?.source === "stock";

    return (
        <aside className="flex w-56 flex-col gap-4 overflow-y-auto border-r border-border bg-panel p-3">
            <Section icon={<Footprints className="h-3.5 w-3.5" />} title="Pattern">
                {usingStockBase ? (
                    <p className="mb-1.5 text-[10px] text-muted-foreground">
                        Base: {design.paired?.rightBase?.name ?? design.base?.name ?? "Stock GLB"} · patterns adjust scan metadata only
                    </p>
                ) : null}
                <div className="grid grid-cols-2 gap-1.5">
                    {merged.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => void onPattern(p.id, p.stock)}
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
                            {!p.stock ? (
                                <span className="mt-0.5 block text-[9px] text-primary">custom</span>
                            ) : null}
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
                <input
                    ref={uploadRef}
                    type="file"
                    accept=".glb"
                    multiple
                    className="hidden"
                    onChange={(e) => void onUpload(e.target.files)}
                />
                <button
                    type="button"
                    disabled={uploadBusy}
                    onClick={() => uploadRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-2 py-2.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                >
                    <Upload className="h-3.5 w-3.5" />
                    {uploadBusy ? "Uploading…" : "Upload .glb base"}
                </button>
                {uploadError ? <p className="mt-1 text-[11px] text-destructive">{uploadError}</p> : null}

                {libraryLoading ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">Loading…</p>
                ) : customPrefabs.length === 0 ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        Upload a `.glb` base, or save a modified insole/shell to reuse it here.
                    </p>
                ) : (
                    <div className="mt-2 space-y-1">
                        {customPrefabs.map((p) =>
                            renamingId === p.id ? (
                                <div key={p.id} className="flex items-center gap-1">
                                    <Input
                                        value={renameValue}
                                        autoFocus
                                        className="h-7 flex-1 text-[11px]"
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") commitRename(p.id);
                                            if (e.key === "Escape") setRenamingId(null);
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="text-emerald-500 hover:text-emerald-400"
                                        onClick={() => commitRename(p.id)}
                                        title="Save name"
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => setRenamingId(null)}
                                        title="Cancel"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <div key={p.id} className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => onPattern(p.id, false)}
                                        className={cn(
                                            "flex-1 truncate rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-left text-[11px]",
                                            design.customPrefabId === p.id && "border-primary bg-primary/15",
                                        )}
                                        title={p.uploaded ? "Uploaded GLB base" : "Saved base"}
                                    >
                                        <span className="truncate">{p.name}</span>
                                        <span className="mt-0.5 flex items-center gap-1 text-[9px] text-primary">
                                            {p.uploaded ? "uploaded" : "custom"}
                                            {p.meshCount && p.meshCount > 1 ? (
                                                <span className="text-muted-foreground">
                                                    · {p.meshCount} meshes
                                                </span>
                                            ) : null}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                                        disabled={mirroringId === p.id}
                                        onClick={() => void onMirror(p.id)}
                                        title="Mirror base (Left ↔ Right)"
                                    >
                                        <FlipHorizontal className="h-3 w-3" />
                                    </button>
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                            setRenamingId(p.id);
                                            setRenameValue(p.name);
                                        }}
                                        title="Rename"
                                    >
                                        <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-destructive"
                                        onClick={() => void deleteCustomAsset("prefab", p.id)}
                                        title="Delete"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </button>
                                </div>
                            ),
                        )}
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

function Section({
    icon,
    title,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}) {
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
