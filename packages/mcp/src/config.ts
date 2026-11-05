import { z } from "zod";

const envSchema = z.object({
    ORTHOCAD_API_BASE: z.string().url().optional(),
    ORTHOCAD_MCP_API_KEY: z.string().min(1).optional(),
    /** Supabase access token or other Bearer accepted by vertex protectedProcedure. */
    ORTHOCAD_MCP_TRPC_BEARER: z.string().min(1).optional(),
});

export type OrthocadMcpConfig = z.infer<typeof envSchema> & {
    apiBase: string;
    trpcUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrthocadMcpConfig {
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
        throw new Error(`Invalid MCP environment: ${parsed.error.message}`);
    }
    const apiBase = (parsed.data.ORTHOCAD_API_BASE ?? "http://127.0.0.1:3001").replace(/\/+$/, "");
    const trpcUrl = apiBase.endsWith("/trpc") ? apiBase : `${apiBase}/trpc`;
    return { ...parsed.data, apiBase, trpcUrl };
}

export function requireIntegrationKey(config: OrthocadMcpConfig): string {
    const key = config.ORTHOCAD_MCP_API_KEY?.trim();
    if (!key) {
        throw new Error(
            "ORTHOCAD_MCP_API_KEY is required for integration REST tools (Bearer ocad_* integration key).",
        );
    }
    if (/\s/.test(key)) {
        throw new Error("ORTHOCAD_MCP_API_KEY must not contain whitespace.");
    }
    return key;
}

export function requireTrpcBearer(config: OrthocadMcpConfig): string {
    const token = config.ORTHOCAD_MCP_TRPC_BEARER?.trim();
    if (!token) {
        throw new Error(
            "ORTHOCAD_MCP_TRPC_BEARER is required for manufacturing and design tRPC tools " +
                "(Supabase session access token for a licensed OrthoCAD user).",
        );
    }
    return token;
}
