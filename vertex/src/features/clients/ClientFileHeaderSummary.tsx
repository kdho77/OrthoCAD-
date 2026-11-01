// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ClientRecord } from "@/stores/client-store";
import { formatClientShoeSummary, shoeChartFromInput } from "../../../shared/client-files";

export function clientFileHeaderParts(client: ClientRecord): string[] {
    const chart = shoeChartFromInput(client);
    const parts = [formatClientShoeSummary(chart)];
    if (client.orderedBy?.trim()) parts.push(`Ordered by ${client.orderedBy.trim()}`);
    if (client.reference?.trim()) parts.push(`Ref ${client.reference.trim()}`);
    return parts;
}

export function ClientFileHeaderSummary({ client }: { client: ClientRecord }) {
    const parts = clientFileHeaderParts(client);
    return (
        <p className="text-sm text-muted-foreground" data-testid="client-file-header-meta">
            {parts.join(" · ")}
        </p>
    );
}
