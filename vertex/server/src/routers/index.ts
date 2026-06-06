import { router } from "../trpc";
import { exportRouter } from "./export";
import { userRouter } from "./user";

export const appRouter = router({
    user: userRouter,
    export: exportRouter,
});

export type AppRouter = typeof appRouter;
