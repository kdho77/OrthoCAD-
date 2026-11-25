// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PrescriptionApplyReview } from "@/components/prescription-upload/PrescriptionApplyReview";
import {
    applyReviewedPrescriptionToCurrentDesign,
    parseAiPrescriptionText,
} from "@/features/clinical/ai-generate-from-text";
import type { PrescriptionParseResult } from "@/types";

export function SetupAiGenerateButton() {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [review, setReview] = useState<PrescriptionParseResult | null>(null);

    const onGenerate = async () => {
        setBusy(true);
        setError(null);
        setReview(null);
        try {
            const result = await parseAiPrescriptionText(text);
            setReview(result);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Parse failed");
        } finally {
            setBusy(false);
        }
    };

    const closeAll = () => {
        setOpen(false);
        setReview(null);
        setText("");
        setError(null);
    };

    return (
        <div className="relative">
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[10px]"
                data-testid="setup-ai-generate"
                onClick={() => setOpen((value) => !value)}
            >
                <Sparkles className="h-3 w-3" />
                AI Generate from text
            </Button>
            {open ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-80 max-h-[min(70vh,32rem)] overflow-y-auto space-y-2 rounded-md border border-border bg-panel p-2 shadow-lg">
                    {review ? (
                        <PrescriptionApplyReview
                            result={review}
                            onApply={(edited) => {
                                applyReviewedPrescriptionToCurrentDesign(edited);
                                closeAll();
                            }}
                            onCancel={() => setReview(null)}
                        />
                    ) : (
                        <>
                            <textarea
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                rows={3}
                                aria-label="Prescription text"
                                className="w-full resize-none rounded-md border border-input bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                            <Button
                                type="button"
                                className="h-8 w-full text-[11px]"
                                disabled={busy || !text.trim()}
                                onClick={() => void onGenerate()}
                            >
                                {busy ? "Parsing…" : "Parse with AI"}
                            </Button>
                        </>
                    )}
                    {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
                </div>
            ) : null}
        </div>
    );
}