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
import * as React from "react";
import { ConfirmDeleteTrigger } from "@/components/clinical/ConfirmDeleteDialog";
import { PanelHeading } from "@/components/clinical/PanelHeading";
import { productionMethodDisabledInUi } from "@/components/layout/production-method-ui";
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
import { getActiveFootSide, useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { stockBaseDisplayName } from "@/lib/geometry/base-asset";
import { SAMPLE_TOP_NAME } from "@/lib/geometry/procedural-wall/sample-top-id";
import {
    displaySizeForUsMen,
    formatFootLengthLabel,
    formatHalfSize,
    formatUkShoeSizeLabel,
    formatUsShoeSizeLabel,
    insoleLayoutFromDesign,
    normalizeShoeSizeSystem,
    type ShoeSizeDisplayUnit,
    shoeSizePickerOptions,
    usMenSizeForSide,
    usMenSizeFromDisplayUnit,
} from "@/lib/geometry/shoe-size";
import {
    hasHeelWidthOverride,
    normalizeShoeWidth,
    SHOE_WIDTH_LABELS,
    type ShoeWidthId,
    shoeWidthForSide,
    shoeWidthHint,
} from "@/lib/geometry/shoe-width";
import { mergePrefabLibrary, STOCK_PREFABS } from "@/lib/library/manifest";
import { cn } from "@/lib/utils";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { ProductionMethod, ScanPattern, Side } from "@/types";

// Classic JSX runtime (rstest) reads the React value. The app build uses the automatic runtime.
const { useEffect, useRef, useState } = React;

const METHODS: { id: ProductionMethod; label: string }[] = [
    { id: "printing_solid", label: "Printing — Solid" },
    { id: "printing_shell", label: "Printing — Shell" },
    { id: "milling_3axis", label: "Milling — 3 Axis" },
];

export function LeftSidebar({
    sections,
    embedded,
    clinicalDeclutter,
}: {
    sections?: Array<"pattern" | "library" | "production" | "size" | "import">;
    embedded?: boolean;
    clinicalDeclutter?: "setup" | "base";
} = {}) {
    const { design, setPattern, setMethod } = useDesignStore();
    const customPrefabs = useCustomLibraryStore((s) => s.customPrefabs);
    const libraryLoading = useCustomLibraryStore((s) => s.loading);
    const baseMeshLoading = useDesignStore(
        (s) => s.baseMeshLoadingBySide.left || s.baseMeshLoadingBySide.right,
    );
    const setEditMode = useMeshEditStore((s) => s.setEditMode);
    const setTarget = useMeshEditStore((s) => s.setTarget);
    const merged = mergePrefabLibrary(customPrefabs);
    const [saveOpen, setSaveOpen] = useState(false);
    const [saveSide, setSaveSide] = useState<Side | "both">("left");
    const placementFoot = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
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
        const side = getActiveFootSide();
        if (stock) {
            // Pattern presets drive the faired bottom on SAMPLE_Top; the GLB stays.
            setPattern(id as ScanPattern);
            setTarget({ type: "insole", side });
        } else {
            await selectCustomPrefab(id, customPrefabs.find((p) => p.id === id)?.name ?? "Custom Prefab");
            setTarget({ type: "insole", side });
        }
        setEditMode("transform");
    };

    const usingStockBase =
        design.paired?.leftBase?.source === "stock" ||
        design.paired?.rightBase?.source === "stock" ||
        design.base?.source === "stock";

    const show = (id: "pattern" | "library" | "production" | "size" | "import") =>
        !sections || sections.includes(id);
    const stockPatterns = merged.filter((p) => p.stock && (p.id === "full_contact" || p.id === "prefab_3d"));

    return (
        <div
            className={
                embedded
                    ? "flex flex-col gap-4"
                    : "flex w-56 flex-col gap-4 overflow-y-auto border-r border-border bg-panel p-3"
            }
        >
            {show("pattern") ? (
                <Section icon={<Footprints className="h-3.5 w-3.5" />} title="Pattern">
                    {usingStockBase ? (
                        <p className="mb-1.5 text-[10px] text-muted-foreground">
                            Base:{" "}
                            {stockBaseDisplayName(
                                design.base ?? design.paired?.leftBase ?? design.paired?.rightBase,
                            ) || SAMPLE_TOP_NAME}{" "}
                            · Prefab 3D / Full Contact only
                        </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-1.5">
                        {stockPatterns.map((p) => (
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
                    <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2 h-7 w-full gap-1 text-[11px]"
                        onClick={() => {
                            const side =
                                placementFoot === "right"
                                    ? "right"
                                    : placementFoot === "both"
                                      ? "both"
                                      : "left";
                            setSaveSide(side);
                            if (side !== "both") setTarget({ type: "insole", side });
                            setSaveOpen(true);
                        }}
                    >
                        <Save className="h-3 w-3" />
                        Save to library
                        {placementFoot === "both"
                            ? " (Pair)"
                            : placementFoot === "right"
                              ? " (Right)"
                              : " (Left)"}
                    </Button>
                </Section>
            ) : null}

            {show("library") ? (
                <div className="space-y-2">
                    <PanelHeading
                        title="My library"
                        info="Upload a .glb base, or save a modified insole or shell to reuse it here."
                    />
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

                    {libraryLoading || baseMeshLoading ? (
                        <p className="mt-2 text-[11px] text-muted-foreground">Loading…</p>
                    ) : customPrefabs.length === 0 ? (
                        <p className="mt-2 text-center text-[10px] text-muted-foreground">No custom bases</p>
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
                                                design.customPrefabId === p.id &&
                                                    "border-primary bg-primary/15",
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
                                        <ConfirmDeleteTrigger
                                            title="Delete custom base?"
                                            description={`Remove "${p.name}" from your library?`}
                                            onConfirm={() => void deleteCustomAsset("prefab", p.id)}
                                            className="text-muted-foreground hover:text-destructive"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </ConfirmDeleteTrigger>
                                    </div>
                                ),
                            )}
                        </div>
                    )}
                </div>
            ) : null}

            {show("production") ? (
                <Section
                    icon={<Layers3 className="h-3.5 w-3.5" />}
                    title={clinicalDeclutter === "setup" ? "Shell" : "Production"}
                >
                    <div className="flex flex-col gap-1.5">
                        {METHODS.map((m) => {
                            const shellUiLocked = productionMethodDisabledInUi(m.id);
                            const selected = design.method === m.id;
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    disabled={shellUiLocked}
                                    data-testid={`production-method-${m.id}`}
                                    onClick={() => {
                                        if (shellUiLocked) return;
                                        setMethod(m.id);
                                    }}
                                    className={cn(
                                        "rounded-md border px-2 py-2 text-left text-xs transition-colors",
                                        shellUiLocked &&
                                            "cursor-not-allowed border-border/60 bg-muted/30 text-muted-foreground/70 opacity-60",
                                        !shellUiLocked &&
                                            selected &&
                                            "border-primary bg-primary/10 text-foreground",
                                        !shellUiLocked &&
                                            !selected &&
                                            "border-border bg-background text-muted-foreground hover:border-primary/50",
                                        shellUiLocked &&
                                            selected &&
                                            "border-border/60 bg-muted/20 text-muted-foreground/80",
                                    )}
                                >
                                    <span className="flex items-center justify-between gap-2">
                                        <span>
                                            {clinicalDeclutter === "setup" && m.id === "printing_solid"
                                                ? "Solid print"
                                                : m.label}
                                        </span>
                                        {shellUiLocked ? (
                                            <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                                Coming soon
                                            </span>
                                        ) : null}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </Section>
            ) : null}

            {show("size") ? (
                <Section
                    icon={<Footprints className="h-3.5 w-3.5" />}
                    title={clinicalDeclutter === "setup" ? "Shoe size" : "Size"}
                >
                    <SetupShoeSizeSelect />
                    <ShoeWidthSelect />
                </Section>
            ) : null}

            {show("import") ? (
                <Section icon={<FileBox className="h-3.5 w-3.5" />} title="Import">
                    <ScanImport />
                </Section>
            ) : null}

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
        </div>
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

const SIZE_TABS: { id: ShoeSizeDisplayUnit; label: string }[] = [
    { id: "us", label: "US" },
    { id: "uk", label: "UK" },
    { id: "mm", label: "mm" },
];

function storedSizeTab(system: string | undefined): ShoeSizeDisplayUnit {
    const normalized = normalizeShoeSizeSystem(system);
    return normalized === "uk" || normalized === "mm" ? normalized : "us";
}

/** Setup size dropdown. The US/UK/mm tabs only change the labels. */
export function SetupShoeSizeSelect() {
    const design = useDesignStore((s) => s.design);
    const setUsShoeSize = useDesignStore((s) => s.setUsShoeSize);
    const linked = design.corrections.linked;
    const active = useActiveFootSide();
    const [unit, setUnit] = useState<ShoeSizeDisplayUnit>(storedSizeTab(design.sizeSystem));
    const left = usMenSizeForSide(design, "left");
    const right = usMenSizeForSide(design, "right");
    const differ = left !== right;
    const foot: Side | null = linked ? null : active;
    const shownMen = foot === "right" ? right : left;
    const storedSystem = normalizeShoeSizeSystem(design.sizeSystem);

    const selectClass =
        "h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

    const displayValue = (men: number) => String(displaySizeForUsMen(unit, men));

    const sharedSelectValue = () => {
        if (!differ && unit === "uk" && storedSystem === "uk" && design.ukSize != null) {
            return String(design.ukSize);
        }
        if (!differ && unit === "mm" && storedSystem === "mm" && design.footLengthMm != null) {
            return String(Math.round(design.footLengthMm));
        }
        return displayValue(shownMen);
    };

    const commit = (display: number) => {
        const men = usMenSizeFromDisplayUnit(unit, display);
        if (foot) setUsShoeSize(men, foot);
        else setUsShoeSize(men);
    };

    const dimension = (side: Side) => {
        const layout = insoleLayoutFromDesign(design, side);
        return `${layout.lengthMm.toFixed(0)} × ${layout.widthMm.toFixed(0)} mm`;
    };

    const singleLabel =
        unit === "us"
            ? formatUsShoeSizeLabel(shownMen)
            : unit === "uk"
              ? formatUkShoeSizeLabel(displaySizeForUsMen("uk", shownMen))
              : formatFootLengthLabel(displaySizeForUsMen("mm", shownMen));

    const ariaLabel =
        linked && differ
            ? "Shoe size for both feet"
            : foot === "right"
              ? "Right shoe size"
              : foot === "left"
                ? "Left shoe size"
                : unit === "uk"
                  ? "UK shoe size"
                  : unit === "mm"
                    ? "Foot length millimetres"
                    : "US shoe size";

    return (
        <div className="space-y-1.5" data-testid="setup-shoe-size">
            <div className="grid grid-cols-3 gap-1">
                {SIZE_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        data-testid={`shoe-size-unit-${tab.id}`}
                        onClick={() => setUnit(tab.id)}
                        className={cn(
                            "rounded border px-1 py-1 text-center text-[10px]",
                            unit === tab.id
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-muted",
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {linked && differ ? (
                <p data-testid="setup-shoe-size-both" className="text-[10px] text-foreground">
                    L {formatUsShoeSizeLabel(left)} · R {formatUsShoeSizeLabel(right)}
                </p>
            ) : foot ? (
                <p className="text-[10px] font-medium uppercase text-muted-foreground">
                    {foot === "left" ? "Left" : "Right"}
                </p>
            ) : null}

            <select
                className={selectClass}
                data-testid="setup-shoe-size-select"
                aria-label={ariaLabel}
                value={linked && differ ? "" : sharedSelectValue()}
                onChange={(event) => {
                    if (!event.target.value) return;
                    commit(Number(event.target.value));
                }}
            >
                {linked && differ ? (
                    <option value="">
                        L {formatHalfSize(left)} / R {formatHalfSize(right)}
                    </option>
                ) : null}
                {shoeSizePickerOptions(unit).map((opt) => (
                    <option key={`${unit}-${opt.value}`} value={String(opt.value)}>
                        {opt.label}
                    </option>
                ))}
            </select>

            <p className="text-[10px] text-muted-foreground" data-testid="setup-shoe-size-dimensions">
                {linked && differ ? (
                    <>
                        L {dimension("left")} · R {dimension("right")}
                    </>
                ) : (
                    <>
                        {singleLabel} · {dimension(foot ?? "left")}
                    </>
                )}
            </p>
        </div>
    );
}

function ShoeWidthSelect() {
    const linked = useDesignStore((s) => s.design.corrections.linked);
    const design = useDesignStore((s) => s.design);
    const setShoeWidth = useDesignStore((s) => s.setShoeWidth);
    const ids: ShoeWidthId[] = ["extra_narrow", "narrow", "medium", "wide", "extra_wide", "xx_wide"];

    const renderGrid = (side?: Side) => {
        const width = side ? shoeWidthForSide(design, side) : normalizeShoeWidth(design.shoeWidth);
        const heelOverride = hasHeelWidthOverride(
            side ? design.corrections[side].heelCupWidthMm : design.corrections.left.heelCupWidthMm,
        );
        return (
            <div className="space-y-1">
                {side ? (
                    <p className="text-[10px] font-medium uppercase text-muted-foreground">
                        {side === "left" ? "Left" : "Right"}
                    </p>
                ) : null}
                <div className="grid grid-cols-2 gap-1">
                    {ids.map((id) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setShoeWidth(id, side)}
                            className={cn(
                                "rounded border px-1 py-1 text-center text-[10px]",
                                width === id
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground",
                            )}
                        >
                            {SHOE_WIDTH_LABELS[id]}
                        </button>
                    ))}
                </div>
                <p className="text-[10px] text-muted-foreground">{shoeWidthHint(width)}</p>
                {heelOverride ? (
                    <button
                        type="button"
                        onClick={() => useClinicalWorkflowStore.getState().setStep("corrections")}
                        className="text-[10px] text-amber-200/90 underline-offset-2 hover:underline"
                    >
                        Heel width set in Corrections
                    </button>
                ) : null}
            </div>
        );
    };

    if (linked) return <div className="space-y-1.5">{renderGrid()}</div>;
    return (
        <div className="grid grid-cols-2 gap-2">
            {renderGrid("left")}
            {renderGrid("right")}
        </div>
    );
}
