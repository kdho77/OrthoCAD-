// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { HelpCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function HelpPopover({
    children,
    className,
    label = "Shortcuts and status help",
}: {
    children: ReactNode;
    className?: string;
    label?: string;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLSpanElement>(null);
    const panelId = useId();

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        const onPointer = (e: MouseEvent | TouchEvent) => {
            const el = rootRef.current;
            if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("mousedown", onPointer);
        window.addEventListener("touchstart", onPointer);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("mousedown", onPointer);
            window.removeEventListener("touchstart", onPointer);
        };
    }, [open]);

    return (
        <span ref={rootRef} className={cn("relative inline-flex", className)}>
            <button
                type="button"
                aria-label={label}
                aria-expanded={open}
                aria-controls={panelId}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/40 text-muted-foreground hover:text-foreground"
                onClick={() => setOpen((v) => !v)}
            >
                <HelpCircle className="h-3 w-3" aria-hidden />
            </button>
            {open ? (
                <div
                    id={panelId}
                    role="dialog"
                    className="absolute bottom-full right-0 z-50 mb-1 w-[min(18rem,calc(100vw-2rem))] rounded-md border border-border bg-panel p-2 text-[11px] leading-snug text-muted-foreground shadow-lg"
                >
                    {children}
                </div>
            ) : null}
        </span>
    );
}
