import { z } from "zod";

const envSchema = z.object({
    ORTHOCAD_API_BASE: z.string().url().optional(),
    /** Dedicated CAD-operator integration credential (not the VO2 order connector key). */
    ORTHOCAD_MCP_API_KEY: z.string().min(1).optional(),
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

export function requireCadOperatorKey(config: OrthocadMcpConfig): string {
    const key = config.ORTHOCAD_MCP_API_KEY?.trim();
    if (!key) {
        throw new Error(
            "ORTHOCAD_MCP_API_KEY is required — issue a dedicated CAD-operator integration credential " +
                "for bot e11f63f7 (not the VO2 order integration key).",
        );
    }
    if (/\s/.test(key)) {
        throw new Error("ORTHOCAD_MCP_API_KEY must not contain whitespace.");
    }
    if (!key.startsWith("ocad_")) {
        throw new Error("ORTHOCAD_MCP_API_KEY must be an OrthoCAD integration key (ocad_… prefix).");
    }
    return key;
}

/** @deprecated Use requireCadOperatorKey */
export const requireIntegrationKey = requireCadOperatorKey;
