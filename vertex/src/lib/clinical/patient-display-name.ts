// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { patientDisplayNameFromParts } from "@/lib/geometry/text-marking/compose";
import { useClientStore } from "@/stores/client-store";

export function activePatientDisplayName(): string | null {
    const { activeClientId, clients } = useClientStore.getState();
    if (!activeClientId) return null;
    const client = clients.find((row) => row.id === activeClientId);
    if (!client) return null;
    const name = patientDisplayNameFromParts(client.firstName, client.lastName);
    return name || null;
}
