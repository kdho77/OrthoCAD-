// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ReactNode } from "react";
import { MeasurementsPanel } from "@/features/measure/MeasurementsPanel";
import type { MeasureProduct } from "@/lib/geometry/measure/types";
import { cn } from "@/lib/utils";
import { useMeasureStore } from "@/stores/measure-store";

/**
 * View | Measurements tabs for every design step.
 * View keeps the existing step controls. Measurements is the print-frame tool.
 * The web app hosts this in the tool column (right on desktop; the Windows
 * reference puts the same pair on the left).
 */
export function MeasurePanelHost({
    children,
    product = "insole",
}: {
    children: ReactNode;
    product?: MeasureProduct;
}) {
    const panel = useMeasureStore((s) => s.panel);
    const setPanel = useMeasureStore((s) => s.setPanel);
    return (
        <>
            <div className="mb-3 flex gap-1" role="tablist" aria-label="Step tools">
                <TabButton active={panel === "view"} testId="panel-tab-view" onClick={() => setPanel("view")}>
                    View
                </TabButton>
                <TabButton
                    active={panel === "measurements"}
                    testId="panel-tab-measurements"
                    onClick={() => setPanel("measurements")}
                >
                    Measurements
                </TabButton>
            </div>
            {panel === "measurements" ? <MeasurementsPanel product={product} /> : children}
        </>
    );
}

function TabButton({
    active,
    testId,
    onClick,
    children,
}: {
    active: boolean;
    testId: string;
    onClick: () => void;
    children: string;
}) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={testId}
            onClick={onClick}
            className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium",
                active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
            )}
        >
            {children}
        </button>
    );
}
