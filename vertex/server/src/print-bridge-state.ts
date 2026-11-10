// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Runtime bridge directory. Rows live in shop_bridges and shop_enrollments.
// The direct Prisma client keeps the one-time redemption transaction on one session.
// Tests construct memoryBridgeDirectory from the shared module instead.

import { prismaDirect } from "./lib/prisma.js";
import { prismaBridgeDirectory } from "./lib/prisma-bridge-directory.js";

export const serverBridgeDirectory = prismaBridgeDirectory(prismaDirect);
