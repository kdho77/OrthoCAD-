// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { PanelHeading } from "@/components/clinical/PanelHeading";
import { SetupAiGenerateButton } from "@/features/clinical/SetupAiGenerateButton";
import { useClientStore } from "@/stores/client-store";
import { formatClientShoeSummary, shoeChartFromInput } from "../../../shared/client-files";

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
                    <PanelHeading title="Shoe size" info="Chart size from the client file. Adjust below if needed." />
                    <span
                        data-testid="setup-client-shoe-tag"
                        className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground"
                    >
                        {clientTag}
                    </span>
                </div>
            ) : null}
            <LeftSidebar embedded sections={["production", "size"]} clinicalDeclutter="setup" />
        </div>
    );
}
