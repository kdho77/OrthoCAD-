# OrthoCAD MCP (Phase A)

Installable MCP server for the **Vertex Orthotic CAD Production Specialist** bot (`e11f63f7`). Wraps existing OrthoCAD **integration REST** and **documented manufacturing tRPC → Python `/manufacture`** path on `main`. **No headless CAD** from scan.

This package is **original `@vertex/orthocad-mcp`**. Do not revive the deleted Chili3D `packages/mcp` tree referenced in `docs/license-classification.md`.

## Connector (bot e11f63f7)

| Item | Phase A choice |
| --- | --- |
| **Transport** | **Stdio** (required for Cursor / Grok `AuthenticateMcpServer`) |
| **HTTP MCP** | Not shipped in Phase A — use stdio child process only |
| **Entry** | `node …/packages/mcp/dist/cli.js` |
| **API origin** | `ORTHOCAD_API_BASE` → integration REST + `${ORTHOCAD_API_BASE}/trpc` for manufacturing wrap |

### Auth (locked)

| Variable | Required | Purpose |
| --- | --- | --- |
| `ORTHOCAD_MCP_API_KEY` | **Yes** | **Dedicated CAD-operator** integration credential (`ocad_…`) issued for bot `e11f63f7`. |
| `ORTHOCAD_API_BASE` | Recommended | OrthoCAD deployment URL (default `http://127.0.0.1:3001`). |

**Do not use:**

- The **VO2 order connector** integration key (VO PM scope — orders CRUD / upload, not CAD-operator MCP).
- **`ORTHOCAD_MCP_TRPC_BEARER` / Supabase JWT** — not part of Phase A auth docs. Phase A is **Bearer CAD-operator key only** against integration + documented manufacturing wrap.

Issue keys with `vertex/server/src/auth/issue-integration-key.ts` (label for CAD Production Specialist; tenant allowlist for CAD tenants). **Never log or print keys.**

### Scopes (logical)

The CAD-operator credential must be allowed for:

- Integration REST (`POST /api/integrations/v1/*`; GET read routes are **Phase B** residual).
- Manufacturing handoff tools that call the documented tRPC wrap (`prepare_manufacturing_stl_upload`, `generate_gcode`, `get_export_download`, `get_design_params`).

## Install

```bash
cd packages/mcp
npm install
npm run build
```

**Cursor / Grok MCP config (stdio):**

```json
{
  "mcpServers": {
    "orthocad": {
      "command": "node",
      "args": ["/absolute/path/to/OrthoCAD-/packages/mcp/dist/cli.js"],
      "env": {
        "ORTHOCAD_API_BASE": "https://your-orthocad-deployment.example",
        "ORTHOCAD_MCP_API_KEY": "<cad-operator-ocad-key-not-vo2-connector>"
      }
    }
  }
}
```

Local dev: `npm run dev` (tsx stdio server).

## Tools (v0)

| Tool | Surface |
| --- | --- |
| `get_design` | Integration REST GET (**Phase B** — client stub today) |
| `list_designs_by_order` | Integration REST GET by order (**Phase B**) |
| `get_design_params` | Documented tRPC wrap → `design.get` |
| `prepare_manufacturing_stl_upload` | tRPC `manufacturing.prepareManufacturingStlUpload` |
| `generate_gcode` | tRPC `manufacturing.generateSolid` → **Python `/manufacture` on main** |
| `get_export_download` | tRPC `manufacturing.getGcodeDownloadUrl` |
| `build_design_exported_payload` | VO handoff object (below) — **no VO order status writes** |

STL/G-code flow: operator builds STL in OrthoCAD UI → `prepare_manufacturing_stl_upload` → PUT STL → `generate_gcode` with `stl_storage_key` → `get_export_download` → `build_design_exported_payload` for VO upload.

### `generate_gcode` / production path

Phase A targets **current production on `main`**: `manufacturing.generateSolid` → `callManufacture` → Python **`/manufacture`**. Open **PR #263** (Apex materials + leader / VertexSlice) is noted as a **residual**; Phase A does **not** depend on #263 merging.

## VO handoff payload (`build_design_exported_payload`)

Tool output shape (exact keys):

```json
{
  "design_id": "uuid",
  "external_order_id": "string",
  "tenant_id": "uuid",
  "source": "vo2",
  "files": [
    {
      "side": "left",
      "machine": "vertexslice",
      "format": "gcode",
      "material": "TPU",
      "download_url": "https://…",
      "expires_at": "2026-11-06T12:00:00.000Z",
      "content_type": "application/octet-stream",
      "filename": "insole-left.gcode"
    }
  ]
}
```

OrthoCAD never writes VO order status.

## Smoke checklist (bot e11f63f7)

1. `npm run build` in `packages/mcp` succeeds.
2. MCP server starts: `ORTHOCAD_MCP_API_KEY=ocad_… ORTHOCAD_API_BASE=… node dist/cli.js` (stdio; no key in logs).
3. Tool list includes seven tools (`get_design` … `build_design_exported_payload`).
4. `build_design_exported_payload` with sample files returns exact VO shape above (no `status` / order fields).
5. `generate_gcode` documentation references main `/manufacture` path, not #263.

## Tests

From repo root:

```bash
npm test -- packages/mcp/test
```

## Phase B / residuals (not implemented in Phase A)

- **GET** integration routes for `get_design` / `list_designs_by_order`.
- **Founder** decision: bot **service-account tRPC** if CAD-operator Bearer is insufficient server-side.
- **Headless CAD** from scan.
- **PR #263** VertexSlice leader path (track separately from Phase A).
