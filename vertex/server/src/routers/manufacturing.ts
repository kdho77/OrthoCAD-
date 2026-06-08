import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { callGenerateSolid } from "../lib/manufacturing-client";
import { RATE_LIMITS } from "../lib/rate-limit";
import { rateLimitedProcedure, router } from "../trpc";

const GENERATE_SOLID_TOKEN_COST = 1;

const grindingStyleSchema = z.object({
    type: z.enum(["straight", "rounded"]),
    angleDegrees: z.number().optional(),
    radiusMm: z.number().optional(),
});

export const manufacturingRouter = router({
    generateSolid: rateLimitedProcedure(RATE_LIMITS.manufacturing, "manufacturing:generateSolid")
        .input(
            z.object({
                jobId: z.string().min(1),
                designId: z.string().uuid(),
                presetId: z.string().min(1),
                baseGlbUrl: z.string().url(),
                corrections: z.record(z.string(), z.unknown()),
                trimlines: z.record(z.string(), z.unknown()),
                heelLiftMm: z.number().default(0),
                heelCupWidthMm: z.number().default(0),
                grindingStyle: grindingStyleSchema,
                thicknessMm: z.number().positive(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const now = new Date();
            const license = await ctx.prisma.license.findFirst({
                where: {
                    status: "active",
                    OR: [{ ownerId: ctx.user.id }, { seatList: { some: { userId: ctx.user.id } } }],
                    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
                },
            });
            if (!license) {
                throw new TRPCError({ code: "FORBIDDEN", message: "No valid license" });
            }

            const pre = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
            if (pre.tokenBalance < GENERATE_SOLID_TOKEN_COST) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Insufficient tokens for solid generation",
                });
            }

            const solid = await callGenerateSolid({
                job_id: input.jobId,
                design_id: input.designId,
                preset_id: input.presetId,
                base_glb_url: input.baseGlbUrl,
                corrections: input.corrections,
                trimlines: input.trimlines,
                heel_lift_mm: input.heelLiftMm,
                heel_cup_width_mm: input.heelCupWidthMm,
                grinding_style: {
                    type: input.grindingStyle.type,
                    angle_degrees: input.grindingStyle.angleDegrees,
                    radius_mm: input.grindingStyle.radiusMm,
                },
                thickness_mm: input.thicknessMm,
            });

            const result = await ctx.prisma.$transaction(async (tx) => {
                const dec = await tx.user.updateMany({
                    where: { id: ctx.user.id, tokenBalance: { gte: GENERATE_SOLID_TOKEN_COST } },
                    data: { tokenBalance: { decrement: GENERATE_SOLID_TOKEN_COST } },
                });
                if (dec.count === 0) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Insufficient tokens for solid generation",
                    });
                }

                const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });

                await tx.tokenTransaction.create({
                    data: {
                        userId: ctx.user.id,
                        type: "deduct",
                        amount: -GENERATE_SOLID_TOKEN_COST,
                        balance: user.tokenBalance,
                        reason: "manufacturing:generate-solid",
                        exportId: null,
                    },
                });

                await tx.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "tokens_deducted",
                        targetId: input.designId,
                        metadata: {
                            operation: "manufacturing:generate-solid",
                            jobId: input.jobId,
                            presetId: input.presetId,
                            tokenCost: GENERATE_SOLID_TOKEN_COST,
                        },
                        ipAddress: ctx.ip,
                    },
                });

                return { balance: user.tokenBalance };
            });

            return {
                jobId: solid.job_id,
                solidStlBase64: solid.solid_stl_base64,
                solidUrl: solid.solid_url,
                metadata: solid.metadata,
                tokenCost: GENERATE_SOLID_TOKEN_COST,
                balance: result.balance,
            };
        }),
});
