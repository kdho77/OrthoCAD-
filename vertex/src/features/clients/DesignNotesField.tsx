// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { commitNotes, editNotes, revertNotes } from "../../../shared/client-files";

interface DesignNotesFieldProps {
    value: string;
    onCommit: (notes: string) => void;
}

/** One-line notes. Blur saves. Escape restores the last saved text. */
export function DesignNotesField({ value, onCommit }: DesignNotesFieldProps) {
    const [saved, setSaved] = useState(value);
    const [draft, setDraft] = useState(value);
    const [tick, setTick] = useState(false);
    const reverting = useRef(false);

    useEffect(() => {
        setSaved(value);
        setDraft(value);
    }, [value]);

    return (
        <div className="flex min-w-0 items-center gap-1">
            <textarea
                aria-label="Design notes"
                data-testid="design-notes"
                rows={1}
                maxLength={500}
                title={saved}
                value={draft}
                className="min-h-11 w-full resize-none truncate rounded-md border border-transparent bg-transparent px-2 py-2 text-xs text-foreground hover:border-border focus:border-border focus:bg-background focus:outline-none"
                onChange={(event) => {
                    reverting.current = false;
                    setDraft(editNotes({ saved, draft }, event.target.value).draft);
                }}
                onBlur={() => {
                    if (reverting.current) {
                        reverting.current = false;
                        setDraft(saved);
                        return;
                    }
                    const next = commitNotes({ saved, draft });
                    setSaved(next.saved);
                    setDraft(next.draft);
                    setTick(true);
                    onCommit(next.saved);
                    window.setTimeout(() => setTick(false), 1500);
                }}
                onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    reverting.current = true;
                    setDraft(revertNotes({ saved, draft }).draft);
                }}
            />
            {tick ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-400">
                    <Check className="h-3 w-3" /> Saved
                </span>
            ) : null}
        </div>
    );
}
