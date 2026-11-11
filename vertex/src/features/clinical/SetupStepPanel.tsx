// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { PanelHeading } from "@/components/clinical/PanelHeading";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { SliderField } from "@/components/ui/slider-field";
import { SetupAiGenerateButton } from "@/features/clinical/SetupAiGenerateButton";
import { rafThrottle } from "@/lib/performance/throttle";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import { formatClientShoeSummary, shoeChartFromInput } from "../../../shared/client-files";

const previewThickness = rafThrottle((mm: number) => {
    usePerformanceStore.getState().setThicknessPreview(mm);
});

function SetupInsoleThicknessField() {
    const thicknessMm = useDesignStore((s) => s.design.thicknessMm);
    const setThickness = useDesignStore((s) => s.setThickness);
    const thicknessPreview = usePerformanceStore((s) => s.thicknessPreview);
    const setThicknessPreview = usePerformanceStore((s) => s.setThicknessPreview);
    const displayThickness = thicknessPreview ?? thicknessMm;

    return (
        <div data-testid="setup-insole-thickness">
            <SliderField
                label="Insole thickness"
                value={displayThickness}
                min={1.5}
                max={8}
                step={0.1}
                unit="mm"
                onPreview={(v) => previewThickness(v)}
                onChange={(v) => {
                    setThickness(v);
                    setThicknessPreview(null);
                }}
            />
        </div>
    );
}

export function SetupStepPanel() {
    const client = useClientStore((s) => {
        const id = s.activeClientId;
        return id ? (s.clients.find((c) => c.id === id) ?? null) : null;
    });
    const clientTag = client ? formatClientShoeSummary(shoeChartFromInput(client)) : null;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">Setup</span>
                <SetupAiGenerateButton />
            </div>
            {clientTag ? (
                <div className="flex flex-wrap items-center gap-2">
                    <PanelHeading
                        title="Shoe size"
                        info="Chart size from the client file. Adjust below if needed."
                    />
                    <span
                        data-testid="setup-client-shoe-tag"
                        className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground"
                    >
                        {clientTag}
                    </span>
                </div>
            ) : null}
            <div className="flex flex-col gap-4">
                <LeftSidebar embedded sections={["production"]} clinicalDeclutter="setup" />
                <LeftSidebar embedded sections={["size"]} clinicalDeclutter="setup" />
                <SetupInsoleThicknessField />
            </div>
        </div>
    );
}
