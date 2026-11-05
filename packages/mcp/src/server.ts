// Copyright (c) 2026 Vertex Orthopedic. OrthoCAD MCP Phase A — stdio transport for CAD Production Specialist bots.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { handleOrthocadTool } from "./tools/handlers.js";
import { MCP_TOOL_DEFINITIONS } from "./tools/schemas.js";

export function createOrthocadMcpServer(config = loadConfig()): McpServer {
    const server = new McpServer({
        name: "orthocad-mcp",
        version: "0.1.0-phase-a",
    });

    for (const tool of MCP_TOOL_DEFINITIONS) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: tool.inputSchema,
            },
            async (args: unknown) => handleOrthocadTool(tool.name, args, { config }),
        );
    }

    return server;
}

export async function runOrthocadMcpStdio(config = loadConfig()): Promise<void> {
    const server = createOrthocadMcpServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
