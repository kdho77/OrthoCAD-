// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { parsePrescription } from "@/features/ai-prescription/parse-service";
import { useDesignStore } from "@/stores/design-store";
import type { DesignState, PrescriptionParseResult } from "@/types";

async function parseOrThrow(text: string): Promise<PrescriptionParseResult> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Enter prescription text");
    const out = await parsePrescription({ text: trimmed });
    if (!out.ok || !out.result) throw new Error(out.reason ?? "Parse failed");
    return out.result;
}

/** Parse prescription text only (review UI applies afterward). */
export async function parseAiPrescriptionText(text: string): Promise<PrescriptionParseResult> {
    return parseOrThrow(text);
}

/** Parse prescription text and apply to the given design snapshot (same as editor apply). */
export async function applyAiGenerateFromText(text: string, base: DesignState): Promise<DesignState> {
    const result = await parseOrThrow(text);
    useDesignStore.getState().loadDesign(base);
    useDesignStore.getState().applyPrescription(result);
    return useDesignStore.getState().design;
}

/** Apply an already-reviewed prescription to the design in the editor. */
export function applyReviewedPrescriptionToCurrentDesign(result: PrescriptionParseResult): void {
    useDesignStore.getState().applyPrescription(result);
}
