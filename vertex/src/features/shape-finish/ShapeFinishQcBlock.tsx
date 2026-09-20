// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import type { ShapeFinishQcItem, ShapeFinishQcStatus } from "@/lib/geometry/shape-finish-gates";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<
    ShapeFinishQcStatus,
    { icon: typeof CheckCircle2; className: string; badge: string }
> = {
    pass: {
        icon: CheckCircle2,
        className: "text-emerald-500/90",
        badge: "Pass",
    },
    risk: {
        icon: AlertTriangle,
        className: "text-amber-500/90",
        badge: "Risk",
    },
    fail: {
        icon: CircleAlert,
        className: "text-destructive",
        badge: "Fail",
    },
};

export function ShapeFinishQcBlock({ items }: { items: ShapeFinishQcItem[] }) {
    return (
        <div className="rounded-md border border-border bg-background/50 p-2 text-xs">
            <p className="mb-2 font-medium text-muted-foreground">QC (shape / finish gates)</p>
            <ul className="space-y-2">
                {items.map((item) => {
                    const meta = STATUS_STYLE[item.status];
                    const Icon = meta.icon;
                    return (
                        <li key={item.key} className="flex gap-2">
                            <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", meta.className)} aria-hidden />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">{item.label}</span>
                                    <span
                                        className={cn(
                                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                            item.status === "pass" && "bg-emerald-500/15 text-emerald-200",
                                            item.status === "risk" && "bg-amber-500/15 text-amber-100",
                                            item.status === "fail" && "bg-destructive/15 text-destructive",
                                        )}
                                    >
                                        {meta.badge}
                                    </span>
                                </div>
                                <p className="mt-0.5 leading-snug text-muted-foreground">{item.detail}</p>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
