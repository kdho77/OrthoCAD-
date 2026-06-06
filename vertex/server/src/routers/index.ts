import { router } from "../trpc";
import { adminRouter } from "./admin";
import { aiRouter } from "./ai";
import { clientRouter } from "./client";
import { designRouter } from "./design";
import { exportRouter } from "./export";
import { userRouter } from "./user";

export const appRouter = router({
    user: userRouter,
    export: exportRouter,
    ai: aiRouter,
    client: clientRouter,
    design: designRouter,
    admin: adminRouter,
});

export type AppRouter = typeof appRouter;
