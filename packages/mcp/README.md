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

- Integration REST (`POST /api/integrations/v1/*` and dogfood GET design read).
- Manufacturing handoff tools that call the documented tRPC wrap (`prepare_manufacturing_stl_upload`, `generate_gcode`, `get_production`, `list_productions_by_design`, `get_export_download`, `get_design_params`).

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
| `get_design` | Integration REST GET (dogfood tenant only) |
| `list_designs_by_order` | Integration REST GET by order (dogfood tenant only) |
| `get_design_params` | Documented tRPC wrap → `design.get` |
| `prepare_manufacturing_stl_upload` | tRPC `manufacturing.prepareManufacturingStlUpload` |
| `generate_gcode` | tRPC `manufacturing.generateSolid` → returns `{production_id, status}` per foot, then lofts and slices asynchronously |
| `get_production` | tRPC `manufacturing.getProduction` |
| `list_productions_by_design` | tRPC `manufacturing.listProductionsByDesign` |
| `get_export_download` | tRPC `manufacturing.getGcodeDownloadUrl` |
| `build_design_exported_payload` | VO handoff object (below) — **no VO order status writes** |
| `persist_saved_design_snapshot` | tRPC `manufacturing.persistSavedDesignSnapshot` — writes `settingsJson` on an existing design |
| `create_saved_design` | tRPC `manufacturing.createSavedDesign` — refresh the dogfood SAMPLE_Top already bound to a vo2 order. Optional `client_id` only confirms that binding. No clinic tenant, no client create, no integration upsert |
| `prepare_vo_attachment` | Live `attach_files` arguments (`orderId`, `external_order_id`, `source: vo2`, L/R G-code bytes or a short https URL). Storage key stays CAD provenance. Does not call VO |

Saved-design belt flow: `generate_gcode` with `use_saved_design: true` and `design_id`. The call returns one `{production_id, status}` per foot before loft and slice finish. Poll `get_production`. When `status` is `succeeded`, call `get_export_download` with that id. No STL file and no G-code bytes are returned. Omitting `side` enqueues both feet. The legacy STL upload path (`prepare_manufacturing_stl_upload` → `stl_storage_key`) uses the same production id when the server accepts it.

### `generate_gcode` / production path

The CAD-operator call creates or reuses a `productions` row first, then returns. Heavy work runs with Vercel `waitUntil` inside the tRPC function (`maxDuration` 300s). Status is `pending`, `running`, `succeeded`, or `failed`. A pending or running row whose lease has expired is `failed` with `Production lease expired` and can be generated again.

Idempotency key: `design + foot + preset + sha256(settings, recipe, material, belt angle, and the STL key when the mesh was uploaded)`. An in-flight or succeeded row is reused and is not charged again. A failed or expired row may run again. The database unique index on `idempotencyKey` plus a row lock in `vertex_charge_existing_production` keep concurrent calls on one row and charge tokens once, on success only.

Phase A still targets **production on `main`**: printer G-code is VertexSlice. **PR #263** merged to `main` as squash **`70e33f8a`** (2026-11-05 America/Boise): Apex materials, VertexSlice locked profiles, and founder-locked leader v2 on the printer G-code path are **on main**. The legacy synchronous description referenced Python **`/manufacture`**. Session-user Print/Export still uses that synchronous `generateSolid` result. CAD-operator calls do not.

Apply `vertex/prisma/migrations/20261109120000_cad_production_async` before deploying this server. The agent does not apply it.

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
3. Tool list includes twelve tools (`get_design` … `prepare_vo_attachment`, plus `get_production` and `list_productions_by_design`).
4. `build_design_exported_payload` with sample files returns exact VO shape above (no `status` / order fields).
5. `generate_gcode` documentation references main `/manufacture` path (VertexSlice/Apex/leader via #263 on main).

## Tests

From repo root:

```bash
npm test -- packages/mcp/test
```

## Phase B

Dogfood tenant `54b6a960-aa40-4988-b116-adf5ed6c72f8` only. CAD-operator Bearer (`ocad_…`) can read designs and call manufacturing prepare / generateSolid / getProduction / listProductionsByDesign / getGcodeDownloadUrl. Session auth is unchanged. Other tRPC procedures still reject the key.

`use_saved_design` lofts with the UI Export path (SAMPLE_Top procedural solid, watertight check, leader once per foot) and returns G-code only.

`persist_saved_design_snapshot` writes that parameter snapshot onto an existing design (`design_id`). It copies the stored integration-link shoe size and width, maps only structured catalog fields, and returns 422 instead of inventing a prescription. `rx_text` and notes are ignored. It does not change File Ready or In Production.

Residuals:

- Reference design `cc357f83-3391-4c93-90b0-e18b6bce1a1d` was not compared. No production credential is available. Mesh parity tests use a sanitized SAMPLE_Top design against `buildPrinterFootManufacturingStl`.
- Headless loft needs the same Node loader as the Export modules (`@/` alias, SAMPLE_Top bytes, DOMParser for the GLB). If that load fails, generateSolid errors and does not substitute a mesh.
- No headless CAD from a scan. No VO order upload. No STL deliverable.
