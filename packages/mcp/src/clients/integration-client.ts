/**
 * Thin HTTP client for integration REST (Bearer **CAD-operator** key — not the VO2 connector key).
 * Read helpers target documented GET routes — Phase B server work at
 * vertex/server/src/routers/integrations/http.ts and service.ts (getDesignForCredential).
 */

export class IntegrationHttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = "IntegrationHttpError";
        this.status = status;
    }
}

export interface IntegrationClientOptions {
    apiBase: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
}

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { error: text.slice(0, 500) };
    }
}

export function createIntegrationClient(options: IntegrationClientOptions) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const base = options.apiBase.replace(/\/+$/, "");

    function authHeaders(): Record<string, string> {
        return {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
        };
    }

    async function get(path: string): Promise<unknown> {
        const response = await fetchImpl(`${base}${path}`, {
            method: "GET",
            headers: { authorization: `Bearer ${options.apiKey}` },
        });
        const body = await readJson(response);
        if (!response.ok) {
            const message =
                body &&
                typeof body === "object" &&
                "error" in body &&
                typeof (body as { error: unknown }).error === "string"
                    ? (body as { error: string }).error
                    : `Integration request failed (${response.status})`;
            throw new IntegrationHttpError(response.status, message);
        }
        return body;
    }

    return {
        /**
         * Phase A: server may return 405 until GET is added on integrations http handler.
         * Call site: vertex/server/src/routers/integrations/http.ts — GET /api/integrations/v1/designs/:id
         */
        async getDesign(designId: string): Promise<unknown> {
            return get(`/api/integrations/v1/designs/${encodeURIComponent(designId)}`);
        },

        /**
         * Call site: vertex/server/src/routers/integrations/http.ts — GET with query params;
         * store.findDesignLink in vertex/server/src/routers/integrations/store.ts:196
         */
        async listDesignsByOrder(input: {
            external_order_id: string;
            tenant_id: string;
            source: "vo2" | "orthocloud";
        }): Promise<unknown> {
            const params = new URLSearchParams({
                external_order_id: input.external_order_id,
                tenant_id: input.tenant_id,
                source: input.source,
            });
            return get(`/api/integrations/v1/designs?${params.toString()}`);
        },
    };
}

export type IntegrationClient = ReturnType<typeof createIntegrationClient>;
