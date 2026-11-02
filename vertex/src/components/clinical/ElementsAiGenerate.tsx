// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { PanelHeading } from "@/components/clinical/PanelHeading";
import { Button } from "@/components/ui/button";
import { parsePrescription } from "@/features/ai-prescription/parse-service";
import { useDesignStore } from "@/stores/design-store";

export function ElementsAiGenerate() {
    const applyPrescription = useDesignStore((s) => s.applyPrescription);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onGenerate = async () => {
        setBusy(true);
        setError(null);
        const out = await parsePrescription({ text: text.trim() });
        if (out.ok && out.result) {
            applyPrescription(out.result);
            setText("");
        } else {
            setError(out.reason ?? "Parse failed");
        }
        setBusy(false);
    };

    return (
        <div className="space-y-1.5">
            <PanelHeading
                title="AI Generate from text"
                info="Paste a short prescription. Parsed corrections apply to the model; nothing is placed until you add elements."
            />
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                aria-label="Prescription text"
                className="w-full resize-none rounded-md border border-input bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button
                type="button"
                className="h-8 w-full text-[12px]"
                disabled={busy || !text.trim()}
                onClick={() => void onGenerate()}
            >
                <Sparkles className="h-3.5 w-3.5" />
                {busy ? "Working…" : "AI Generate from text"}
            </Button>
            {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
        </div>
    );
}
