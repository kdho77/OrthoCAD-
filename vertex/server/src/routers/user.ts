import { protectedProcedure, publicProcedure, router } from "../trpc";

export const userRouter = router({
    // Public health check for load balancers / Render health checks.
    health: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),

    // Returns the authenticated user's profile, token balance and active license.
    me: protectedProcedure.query(async ({ ctx }) => {
        const now = new Date();
        const profile = await ctx.prisma.user.findUnique({ where: { id: ctx.user.id } });
        const license = await ctx.prisma.license.findFirst({
            where: {
                status: "active",
                OR: [{ ownerId: ctx.user.id }, { seatList: { some: { userId: ctx.user.id } } }],
                AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
            },
        });

        return {
            id: ctx.user.id,
            email: profile?.email ?? ctx.user.email,
            fullName: profile?.fullName ?? null,
            role: (profile?.role ?? ctx.user.role) as "super_admin" | "admin" | "clinician",
            tokenBalance: profile?.tokenBalance ?? 0,
            license: license
                ? {
                      id: license.id,
                      type: license.type,
                      status: license.status,
                      seats: license.seats,
                      startsAt: license.startsAt.toISOString(),
                      expiresAt: license.expiresAt?.toISOString() ?? null,
                  }
                : null,
        };
    }),
});
