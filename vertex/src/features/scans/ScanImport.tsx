import { CheckCircle2, Eye, EyeOff, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { importScanFile } from "@/lib/geometry/import";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { useScanStore } from "@/stores/scan-store";
import { cn } from "@/lib/utils";

export function ScanImport() {
    const inputRef = useRef<HTMLInputElement>(null);
    const { scans, addScan, removeScan, setSide, toggleVisible } = useScanStore();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const onFiles = async (files: FileList | null) => {
        if (!files) return;
        setError(null);
        setBusy(true);
        try {
            for (const file of Array.from(files)) {
                const { geometry, format, triangleCount } = await importScanFile(file);
                addScan({
                    id: crypto.randomUUID(),
                    name: file.name,
                    side: "left",
                    format,
                    triangleCount,
                    geometry,
                    manifold: analyzeManifold(geometry),
                });
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Import failed");
        } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    return (
        <div className="space-y-2">
            <input
                ref={inputRef}
                type="file"
                accept=".stl,.obj"
                multiple
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
            />
            <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-2 py-4 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
                <Upload className="h-3.5 w-3.5" />
                {busy ? "Importing…" : "Import STL / OBJ"}
            </button>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            {scans.map((s) => (
                <div key={s.id} className="space-y-1 rounded-md border border-border bg-background p-2 text-xs">
                    <div className="flex items-center justify-between gap-1">
                        <span className="truncate" title={s.name}>
                            {s.name}
                        </span>
                        <div className="flex items-center gap-1">
                            <button type="button" onClick={() => toggleVisible(s.id)} title="Toggle visibility">
                                {s.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                            </button>
                            <button type="button" onClick={() => removeScan(s.id)} title="Remove">
                                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                            {s.format.toUpperCase()} · {s.triangleCount.toLocaleString()} tris
                        </span>
                        <span className={cn("flex items-center gap-1", s.manifold.isWatertight ? "text-emerald-400" : "text-amber-400")}>
                            {s.manifold.isWatertight ? <CheckCircle2 className="h-3 w-3" /> : null}
                            {s.manifold.isWatertight ? "watertight" : `${s.manifold.openEdges} open`}
                        </span>
                    </div>
                    <div className="flex gap-1">
                        {(["left", "right"] as const).map((side) => (
                            <button
                                key={side}
                                type="button"
                                onClick={() => setSide(s.id, side)}
                                className={cn(
                                    "flex-1 rounded px-2 py-1 text-[11px]",
                                    s.side === side ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                                )}
                            >
                                {side}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
