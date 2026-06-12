import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import { rateLimitedProcedure, router } from "../trpc.js";

// Server-side token cost schedule. Authoritative — the client mirror is for UX
// only.
const TOKEN_COST: Record<"stl" | "gcode", number> = { stl: 1, gcode: 2 };

export const exportRouter = router({
    // Authorizes a token-consuming export. Validates license, then atomically
    // deducts tokens, records the export, the token transaction and an audit
    // log entry inside a single transaction. The actual file bytes are produced
    // client-side only after this returns `ok`.
    authorize: rateLimitedProcedure(RATE_LIMITS.export, "export:authorize")
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

            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Supabase admin client not configured",
                });
            }

            const { data, error } = await supabase.rpc("vertex_authorize_export", {
                p_user_id: ctx.user.id,
                p_cost: cost,
                p_design_id: input.designId ?? null,
                p_format: input.format,
                p_side: input.side ?? null,
                p_file_name: input.fileName ?? null,
                p_ip: ctx.ip,
            });

            if (error) {
                if (error.message.includes("INSUFFICIENT_TOKENS")) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Export authorization failed: ${error.message}`,
                });
            }

            const result = data as { exportId: string; balance: number };
            return { ok: true as const, exportId: result.exportId, balance: result.balance };
        }),
});
