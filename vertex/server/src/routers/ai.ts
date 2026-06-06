import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getAiConfig, parsePrescriptionWithAi } from "../lib/ai-provider";
import { RATE_LIMITS } from "../lib/rate-limit";
import { rateLimitedProcedure, router } from "../trpc";

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

            const now = new Date();
            const license = await ctx.prisma.license.findFirst({
                where: {
                    status: "active",
                    OR: [{ ownerId: ctx.user.id }, { seatList: { some: { userId: ctx.user.id } } }],
                    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
                },
            });
            if (!license) throw new TRPCError({ code: "FORBIDDEN", message: "No valid license" });

            // Pre-check balance so we don't call the AI provider for a user who
            // can't pay; the guarded decrement below is the real safeguard.
            const pre = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
            if (pre.tokenBalance < AI_TOKEN_COST) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient tokens for AI generation" });
            }

            const parsed = await parsePrescriptionWithAi(cfg, { text: input.text, image: input.image });

            const result = await ctx.prisma.$transaction(async (tx) => {
                const dec = await tx.user.updateMany({
                    where: { id: ctx.user.id, tokenBalance: { gte: AI_TOKEN_COST } },
                    data: { tokenBalance: { decrement: AI_TOKEN_COST } },
                });
                if (dec.count === 0) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Insufficient tokens for AI generation",
                    });
                }
                const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });

                const rx = await tx.prescription.create({
                    data: {
                        userId: ctx.user.id,
                        designId: input.designId ?? null,
                        inputText: input.text ?? null,
                        parsed,
                        provider: cfg.provider,
                        model: cfg.model,
                        confidence: parsed.confidence,
                        tokenCost: AI_TOKEN_COST,
                    },
                });

                await tx.tokenTransaction.create({
                    data: {
                        userId: ctx.user.id,
                        type: "deduct",
                        amount: -AI_TOKEN_COST,
                        balance: user.tokenBalance,
                        reason: "ai:prescription",
                        exportId: null,
                    },
                });

                await tx.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "ai_prescription_parsed",
                        targetId: rx.id,
                        metadata: { provider: cfg.provider, model: cfg.model, confidence: parsed.confidence },
                        ipAddress: ctx.ip,
                    },
                });

                return { balance: user.tokenBalance };
            });

            return {
                ...parsed,
                provider: cfg.provider,
                tokenCost: AI_TOKEN_COST,
                balance: result.balance,
            };
        }),
});
