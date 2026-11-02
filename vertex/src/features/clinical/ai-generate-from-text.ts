// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { parsePrescription } from "@/features/ai-prescription/parse-service";
import { useDesignStore } from "@/stores/design-store";
import type { DesignState } from "@/types";

/** Parse prescription text and apply to the given design snapshot (same as editor apply). */
export async function applyAiGenerateFromText(text: string, base: DesignState): Promise<DesignState> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Enter prescription text");
    const out = await parsePrescription({ text: trimmed });
    if (!out.ok || !out.result) throw new Error(out.reason ?? "Parse failed");
    useDesignStore.getState().loadDesign(base);
    useDesignStore.getState().applyPrescription(out.result);
    return useDesignStore.getState().design;
}

/** Apply parsed prescription to the design already loaded in the editor. */
export async function applyAiGenerateToCurrentDesign(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Enter prescription text");
    const out = await parsePrescription({ text: trimmed });
    if (!out.ok || !out.result) throw new Error(out.reason ?? "Parse failed");
    useDesignStore.getState().applyPrescription(out.result);
}
