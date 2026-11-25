import { ImageIcon, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { parsePrescription } from "@/features/ai-prescription/parse-service";
import { cn } from "@/lib/utils";
import type { PrescriptionImage, PrescriptionParseResult } from "@/types";
import { PrescriptionApplyReview } from "./PrescriptionApplyReview";

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
                            Review &amp; apply
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 text-xs">
                            {result && onApply ? (
                                <PrescriptionApplyReview
                                    result={result}
                                    onApply={(edited) => {
                                        onApply(edited);
                                        onClose();
                                    }}
                                    onCancel={() => setResult(null)}
                                />
                            ) : result ? (
                                <p className="text-muted-foreground">Apply wiring is not available in this context.</p>
                            ) : (
                                <p className="text-muted-foreground">
                                    Run a parse to review corrections, edit values, then apply to the model.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}