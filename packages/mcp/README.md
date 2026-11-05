# OrthoCAD MCP (Phase A)

Installable MCP server for the **Vertex Orthotic CAD Production Specialist** bot (`e11f63f7`). Phase A wraps existing OrthoCAD integration REST and manufacturing tRPC surfaces only — **no headless CAD / mesh build from scan**.

## Tools (v0)

| Tool | Surface |
| --- | --- |
| `get_design` | Integration REST GET (Phase B route; client stub wired) |
| `list_designs_by_order` | Integration REST GET by `external_order_id` + `tenant_id` + `source` |
| `get_design_params` | tRPC `design.get` (design document / `settingsJson`) |
| `prepare_manufacturing_stl_upload` | tRPC `manufacturing.prepareManufacturingStlUpload` |
| `generate_gcode` | tRPC `manufacturing.generateSolid` (requires uploaded STL) |
| `get_export_download` | tRPC `manufacturing.getGcodeDownloadUrl` |
| `build_design_exported_payload` | `buildDesignExportedEvent` webhook helper → VO upload handoff |

CAD operators finalize STL in the OrthoCAD browser, upload via the signed URL from `prepare_manufacturing_stl_upload`, then call `generate_gcode`. This package does not invoke VertexSlice or OCCT in-process.

## Environment

| Variable | Purpose |
| --- | --- |
| `ORTHOCAD_API_BASE` | OrthoCAD API origin (default `http://127.0.0.1:3001`). tRPC mount is `${ORTHOCAD_API_BASE}/trpc`. |
| `ORTHOCAD_MCP_API_KEY` | Bearer integration key (`ocad_…`) for integration REST tools. **Never log or print.** |
| `ORTHOCAD_MCP_TRPC_BEARER` | Supabase access token (or equivalent) for licensed user — manufacturing + `get_design_params`. |

Reuse the same integration key pattern as `POST /api/integrations/v1/*` (`Authorization: Bearer ocad_…`).

## Install (CAD bot / Grok AuthenticateMcpServer)

```bash
cd packages/mcp
npm install
npm run build
```

**Stdio (recommended for Cursor / Grok MCP auth):**

```json
{
  "mcpServers": {
    "orthocad": {
      "command": "node",
      "args": ["/absolute/path/to/OrthoCAD-/packages/mcp/dist/cli.js"],
      "env": {
        "ORTHOCAD_API_BASE": "https://your-orthocad-deployment.example",
        "ORTHOCAD_MCP_API_KEY": "<integration-key-from-issue-integration-key>",
        "ORTHOCAD_MCP_TRPC_BEARER": "<supabase-access-token>"
      }
    }
  }
}
```

Run locally during development:

```bash
npm run dev
```

## Tests

From repo root (rstest):

```bash
npx rstest packages/mcp/test
```

## Phase B follow-ups (server, not this package)

- `GET /api/integrations/v1/designs/:id` and list-by-order query → wire to `IntegrationStore.getDesign` / `findDesignLink` in `vertex/server/src/routers/integrations/http.ts`.
- Service-account tRPC auth for bots without an interactive Supabase session (Founder decision if Bearer-only is insufficient).
