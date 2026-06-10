import { router } from "../trpc.js";
import { adminRouter } from "./admin.js";
import { aiRouter } from "./ai.js";
import { clientRouter } from "./client.js";
import { designRouter } from "./design.js";
import { exportRouter } from "./export.js";
import { libraryRouter } from "./library.js";
import { manufacturingRouter } from "./manufacturing.js";
import { stockRouter } from "./stock.js";
import { userRouter } from "./user.js";

export const appRouter = router({
    user: userRouter,
    export: exportRouter,
    ai: aiRouter,
    client: clientRouter,
    design: designRouter,
    admin: adminRouter,
    library: libraryRouter,
    stock: stockRouter,
    manufacturing: manufacturingRouter,
});

export type AppRouter = typeof appRouter;
