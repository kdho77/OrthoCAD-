// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface RowMenuItem {
    label: string;
    onSelect: () => void;
    danger?: boolean;
}

export function RowMenu({ items, label = "Row menu" }: { items: RowMenuItem[]; label?: string }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (event: MouseEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    return (
        <div ref={root} className="relative" onClick={(event) => event.stopPropagation()}>
            <button
                type="button"
                aria-label={label}
                aria-expanded={open}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={() => setOpen((value) => !value)}
            >
                <MoreHorizontal className="h-4 w-4" />
            </button>
            {open ? (
                <div
                    role="menu"
                    className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-border bg-panel py-1 shadow-xl"
                >
                    {items.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            className={cn(
                                "flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-secondary",
                                item.danger && "text-destructive",
                            )}
                            onClick={() => {
                                setOpen(false);
                                item.onSelect();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
