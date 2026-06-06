import { ImageIcon, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { parsePrescription } from "@/features/ai-prescription/parse-service";
import { cn } from "@/lib/utils";
import type { PrescriptionImage, PrescriptionParseResult } from "@/types";

interface PrescriptionUploadProps {
    open: boolean;
    onClose: () => void;
    onApply?: (result: PrescriptionParseResult) => void;
}

function fileToImage(file: File): Promise<PrescriptionImage> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const comma = dataUrl.indexOf(",");
            resolve({ mediaType: file.type || "image/png", dataBase64: dataUrl.slice(comma + 1) });
        };
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(file);
    });
}

export function PrescriptionUpload({ open, onClose, onApply }: PrescriptionUploadProps) {
    const [text, setText] = useState("");
    const [imageName, setImageName] = useState<string | null>(null);
    const [image, setImage] = useState<PrescriptionImage | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PrescriptionParseResult | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    if (!open) return null;

    const onImage = async (file: File | undefined) => {
        if (!file) return;
        setImage(await fileToImage(file));
        setImageName(file.name);
    };

    const onParse = async () => {
        setBusy(true);
        setError(null);
        setResult(null);
        const out = await parsePrescription({ text, image: image ?? undefined });
        if (out.ok && out.result) setResult(out.result);
        else setError(out.reason ?? "Parsing failed");
        setBusy(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
            <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-panel shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                        <Sparkles className="h-4 w-4 text-primary" /> AI Prescription Upload
                    </h2>
                    <Button size="icon" variant="ghost" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="grid flex-1 grid-cols-2 gap-4 overflow-hidden p-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-muted-foreground">Prescription text</label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={
                                "e.g. Bilateral 4° rearfoot varus posting, 4mm medial heel skive left, met pads bilaterally, deep heel cup, high arch."
                            }
                            className="flex-1 resize-none rounded-md border border-input bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => void onImage(e.target.files?.[0])}
                        />
                        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                            <ImageIcon className="h-3.5 w-3.5" /> {imageName ?? "Attach prescription image"}
                        </Button>
                        <Button onClick={onParse} disabled={busy}>
                            <Sparkles className="h-4 w-4" /> {busy ? "Parsing…" : "Parse with AI · 3 tokens"}
                        </Button>
                        {error ? <p className="text-xs text-destructive">{error}</p> : null}
                    </div>

                    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-background/50">
                        <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Structured result
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 text-xs">
                            {result ? (
                                <ResultView result={result} />
                            ) : (
                                <p className="text-muted-foreground">
                                    Run a parse to see structured corrections and elements.
                                </p>
                            )}
                        </div>
                        {result ? (
                            <div className="border-t border-border p-2">
                                <Button
                                    className="w-full"
                                    disabled={!onApply}
                                    title={
                                        onApply ? "Apply to the 3D model" : "Auto-apply arrives in Phase 2"
                                    }
                                    onClick={() => onApply?.(result)}
                                >
                                    {onApply ? "Apply to model" : "Apply to model (Phase 2)"}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ResultView({ result }: { result: PrescriptionParseResult }) {
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-[11px]">
                <Badge label={`provider: ${result.provider}`} />
                <Badge label={`confidence: ${(result.confidence * 100).toFixed(0)}%`} />
                {result.tokenCost ? <Badge label={`-${result.tokenCost} tokens`} /> : null}
                {result.pattern ? <Badge label={`pattern: ${result.pattern}`} /> : null}
                {result.method ? <Badge label={`method: ${result.method}`} /> : null}
            </div>

            {(["left", "right"] as const).map((side) => {
                const patch = result.corrections[side];
                if (!patch || Object.keys(patch).length === 0) return null;
                return (
                    <div key={side}>
                        <div className="mb-1 text-[10px] uppercase text-primary/80">{side} corrections</div>
                        <div className="space-y-0.5">
                            {Object.entries(patch).map(([k, v]) => (
                                <div key={k} className="flex justify-between">
                                    <span className="text-muted-foreground">{k}</span>
                                    <span className="tabular-nums">{v}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}

            {result.elements.length > 0 ? (
                <div>
                    <div className="mb-1 text-[10px] uppercase text-primary/80">elements</div>
                    <div className="flex flex-wrap gap-1">
                        {result.elements.map((e, i) => (
                            <Badge key={`${e.kind}-${e.side}-${i}`} label={`${e.kind} (${e.side})`} />
                        ))}
                    </div>
                </div>
            ) : null}

            {result.notes ? <p className="text-muted-foreground">{result.notes}</p> : null}
        </div>
    );
}

function Badge({ label }: { label: string }) {
    return <span className={cn("rounded bg-muted px-1.5 py-0.5 text-[11px]")}>{label}</span>;
}
