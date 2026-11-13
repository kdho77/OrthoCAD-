// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ExportOutcome } from "@/features/exports/export-service";
import { isStaleBuild } from "@/lib/app-version";
import { useAppVersionStore } from "@/lib/app-version-store";

export const STALE_BUILD_EXPORT_MESSAGE = "OrthoCAD was updated. Reload to export with the latest version.";

export function blockExportIfStaleBuild(): boolean {
    if (!isStaleBuild()) return false;
    useAppVersionStore.getState().openExportBlockedModal();
    return true;
}

export function staleBuildExportOutcome(): ExportOutcome {
    return { ok: false, reason: STALE_BUILD_EXPORT_MESSAGE };
}
