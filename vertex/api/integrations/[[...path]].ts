// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Vercel function for POST /api/integrations/v1/*. This file is a route, not a helper.
// The handler lives in server/src and never returns the API key.

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleIntegrationNode } from "../../server/src/routers/integrations/node-http.js";
import { ensureIntegrationProduction } from "../../server/src/routers/integrations/production.js";

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    ensureIntegrationProduction();
    await handleIntegrationNode(req, res);
}
