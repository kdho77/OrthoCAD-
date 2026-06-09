import { router } from "../trpc";
import { adminRouter } from "./admin";
import { aiRouter } from "./ai";
import { clientRouter } from "./client";
import { designRouter } from "./design";
import { exportRouter } from "./export";
import { libraryRouter } from "./library";
import { manufacturingRouter } from "./manufacturing";
import { router } from "../trpc";
import { adminRouter } from "./admin";
import { aiRouter } from "./ai";
import { clientRouter } from "./client";
import { designRouter } from "./design";
import { exportRouter } from "./export";
import { libraryRouter } from "./library";
import { manufacturingRouter } from "./manufacturing";
import { stockRouter } from "./stock";
import { userRouter } from "./user";

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
