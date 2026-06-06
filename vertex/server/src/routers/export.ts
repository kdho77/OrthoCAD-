import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

// Server-side token cost schedule. Authoritative — the client mirror is for UX
// only.
const TOKEN_COST: Record<"stl" | "gcode", number> = { stl: 1, gcode: 2 };

export const exportRouter = router({
    // Authorizes a token-consuming export. Validates license, then atomically
    // deducts tokens, records the export, the token transaction and an audit
    // log entry inside a single transaction. The actual file bytes are produced
    // client-side only after this returns `ok`.
    authorize: protectedProcedure
        .input(
            z.object({
                format: z.enum(["stl", "gcode"]),
                side: z.enum(["left", "right"]).optional(),
                designId: z.string().uuid().optional(),
                fileName: z.string().max(200).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const cost = TOKEN_COST[input.format];
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

            const result = await ctx.prisma.$transaction(async (tx) => {
                // Guarded decrement: only succeeds if balance is sufficient.
                const dec = await tx.user.updateMany({
                    where: { id: ctx.user.id, tokenBalance: { gte: cost } },
                    data: { tokenBalance: { decrement: cost } },
                });
                if (dec.count === 0) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }

                const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });

                const exp = await tx.export.create({
                    data: {
                        designId: input.designId ?? null,
                        userId: ctx.user.id,
                        format: input.format,
                        side: input.side ?? null,
                        tokenCost: cost,
                        fileName: input.fileName ?? null,
                    },
                });

                await tx.tokenTransaction.create({
                    data: {
                        userId: ctx.user.id,
                        type: "deduct",
                        amount: -cost,
                        balance: user.tokenBalance,
                        reason: `export:${input.format}`,
                        exportId: exp.id,
                    },
                });

                await tx.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "export_generated",
                        targetId: exp.id,
                        metadata: { format: input.format, side: input.side ?? null },
                        ipAddress: ctx.ip,
                    },
                });

                return { exportId: exp.id, balance: user.tokenBalance };
            });

            return { ok: true as const, ...result };
        }),
});
