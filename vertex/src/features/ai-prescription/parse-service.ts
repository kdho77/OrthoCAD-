import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import type { PrescriptionInput, PrescriptionParseResult } from "@/types";

export interface ParseOutcome {
    ok: boolean;
    reason?: string;
    result?: PrescriptionParseResult;
}

/**
 * Parses a prescription into structured params.
 *   - Server path (API configured): `ai.parsePrescription` runs the AI provider
 *     server-side, deducts tokens and records an audit entry.
 *   - Offline fallback: local heuristic parser (no token cost) so the
 *     upload→params flow works in dev/preview.
 */
export async function parsePrescription(input: PrescriptionInput): Promise<ParseOutcome> {
    if (!input.text?.trim() && !input.image) {
        return { ok: false, reason: "Provide prescription text or an image" };
    }

    if (isApiConfigured()) {
        try {
            const res = await trpc.ai.parsePrescription.mutate({
                text: input.text,
                image: input.image,
                designId: input.designId,
            });
            const { user, setUser } = useAuthStore.getState();
            if (user && typeof res.balance === "number") setUser({ ...user, tokenBalance: res.balance });
            useAuditStore.getState().record("ai_prescription_parsed", `AI parse (${res.provider}, -${res.tokenCost})`);
            return { ok: true, result: res as PrescriptionParseResult };
        } catch (e) {
            return { ok: false, reason: e instanceof Error ? e.message : "AI parsing failed" };
        }
    }

    // Offline heuristic. Image-only input isn't supported without the AI server.
    if (!input.text?.trim()) {
        return { ok: false, reason: "Image parsing requires the AI server (set VITE_API_URL + AI_API_KEY)" };
    }
    const { heuristicParse } = await import("./heuristic");
    return { ok: true, result: heuristicParse(input.text) };
}
