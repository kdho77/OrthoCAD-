import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getAiConfig, parsePrescriptionWithAi } from "../lib/ai-provider.js";
import { getSupabaseAdmin } from "../context.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import {
    assertActiveLicense,
    getUserTokenBalance,
    requireSupabaseAdmin,
} from "../lib/supabase-db.js";
import { rateLimitedProcedure, router } from "../trpc.js";

// Token cost for an AI prescription parse / generation.
const AI_TOKEN_COST = 3;

export const aiRouter = router({
    // Parses a free-text / image prescription into structured corrections and
    // elements. Server-authoritative: validates license, calls the AI provider,
    // then atomically deducts tokens and records the prescription + audit log.
    parsePrescription: rateLimitedProcedure(RATE_LIMITS.ai, "ai:parsePrescription")
        .input(
            z
                .object({
                    text: z.string().max(8000).optional(),
                    image: z
                        .object({
                            dataBase64: z.string().max(12_000_000),
                            mediaType: z.string().max(100),
                        })
                        .optional(),
                    designId: z.string().uuid().optional(),
                })
                .refine((v) => Boolean(v.text?.trim()) || Boolean(v.image), {
                    message: "Provide prescription text or an image",
                }),
        )
        .mutation(async ({ ctx, input }) => {
            const cfg = getAiConfig();
            if (!cfg) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "AI provider not configured (set AI_API_KEY)",
                });
            }

            const supabase = requireSupabaseAdmin();
            await assertActiveLicense(supabase, ctx.user.id);

            // Pre-check balance so we don't call the AI provider for a user who
            // can't pay; the guarded decrement below is the real safeguard.
            const balance = await getUserTokenBalance(supabase, ctx.user.id);
            if (balance < AI_TOKEN_COST) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient tokens for AI generation" });
            }

            const parsed = await parsePrescriptionWithAi(cfg, { text: input.text, image: input.image });

            const adminClient = getSupabaseAdmin();
            if (!adminClient) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Supabase admin client not configured",
                });
            }

            const { data, error } = await adminClient.rpc("vertex_charge_ai_prescription", {
                p_user_id: ctx.user.id,
                p_cost: AI_TOKEN_COST,
                p_design_id: input.designId ?? null,
                p_input_text: input.text ?? null,
                p_parsed: parsed,
                p_provider: cfg.provider,
                p_model: cfg.model,
                p_confidence: parsed.confidence ?? null,
                p_ip: ctx.ip,
            });

            if (error) {
                if (error.message.includes("INSUFFICIENT_TOKENS")) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Insufficient tokens for AI generation",
                    });
                }
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `AI prescription charge failed: ${error.message}`,
                });
            }

            const result = data as { balance: number };

            return {
                ...parsed,
                provider: cfg.provider,
                tokenCost: AI_TOKEN_COST,
                balance: result.balance,
            };
        }),
});
