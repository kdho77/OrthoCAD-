// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Server-side VertexSlice proxy. VERTEXSLICE_API_KEY stays on the server.
 * Browser clients POST multipart to /api/slicer (rewrites not required — this
 * file is the Vercel function for that path).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
    handleSlicerRequest,
    incomingMessageToRequest,
    sendFetchResponse,
} from "../server/src/lib/vertexslice-proxy.js";

export const config = {
    api: {
        bodyParser: false,
    },
    maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    try {
        const request = await incomingMessageToRequest(req);
        const response = await handleSlicerRequest(request);
        await sendFetchResponse(res, response);
    } catch (err) {
        console.error("[vercel] slicer proxy crashed", {
            url: req.url,
            method: req.method,
            error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
        if (res.headersSent) {
            res.end();
            return;
        }
        res.status(500);
        res.setHeader("Content-Type", "application/json");
        res.end(
            JSON.stringify({
                ok: false,
                error: {
                    code: "auth_config",
                    cause: "Something on our side. Try again; if it repeats, share this ID",
                    nextStep: "Retry. If it happens again, send this request ID to support.",
                    requestId: "",
                },
            }),
        );
    }
}
