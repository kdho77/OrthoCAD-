// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ReactNode } from "react";
import { InfoPopover } from "@/components/ui/info-popover";
import { cn } from "@/lib/utils";

export function PanelHeading({
    title,
    info,
    className,
    trailing,
}: {
    title: string;
    info?: ReactNode;
    className?: string;
    trailing?: ReactNode;
}) {
    return (
        <div className={cn("flex items-center gap-1.5", className)}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
            </span>
            {info ? <InfoPopover label={`About ${title}`}>{info}</InfoPopover> : null}
            {trailing ? <span className="ml-auto">{trailing}</span> : null}
        </div>
    );
}
