# Production failures, 2026-11-13

Diagnosis only. No product-code change in this PR. IDs below are the ones already in the request. No names, notes, or other chart text.

Base reviewed: `07ad9351` (main, “Smooth flat-plate trim inset from the cast edge”, #349).

A local solid was not lofted here. This workspace has no installed dependencies, and a VertexSlice call would need production credentials. That gap does not change the stored-error conclusion below: a loft failure is kept as a Canonical Export sentence, and the right-side row is the generic fallback instead.

---

## Problem 1 — right production `77a8274e` on design `860ba9f8` (order `05ee4711`)

US Men’s 5, arch high, Hard, bilateral met pad. Left production `7f863b8d` succeeded. Right production `77a8274e` is stored as failed with only `Manufacturing failed`.

### Verified

The exact string `Manufacturing failed` is written in one place: the fallback of `publicProductionError` in `vertex/server/src/lib/cad-operator-production.ts` (lines 277–310). `markFailed` (lines 469–476) stores that string on the `productions.error` column. The Python service (`python-service/app/main.py` line 185) raises `Manufacturing failed: {detail}` on its HTTP body. That longer sentence is not what a CAD-operator row stores. The session `generateSolid` path rethrows and does not call `publicProductionError`.

CAD-operator G-code is one production row per foot. The idempotency key includes the side (`cadOperatorManufacturingIdentity`, lines 381–414). A failed row is eligible to run again; a succeeded row is reused (`decideClaim`, lines 122–128). Left success does not block the right row, and a later right retry with the same settings reuses `77a8274e`.

On failure the server logs the real stack and the sanitized sentence together (`executeCadOperatorProduction`, lines 556–560):

```text
[manufacturing] cad production failed
```

`productionErrorStack` (lines 211–221) keeps the cause chain. The row does not.

Messages that are stored as written, so they were not this row:

| Stored when the thrown message matches | Example |
| --- | --- |
| Prefix `Canonical Export mesh is not available headless` | Any headless loft failure, including the leader-block abort |
| Prefix `VertexSlice timed out after` | Classified slice deadline, including the side in parentheses |
| Prefix `Manufacturing STL ` | Empty STL, triangle cap, non-finite coordinate, degenerate triangles, 450 mm extent |
| Prefix `Manufacturing mesh is not sliceable` | Belt-plate reject, or a simplify that breaks the shell (`slice-mesh.ts` lines 526–551) |
| Prefix `Regional hardness` | Missing 3MF, slicer 422, unconfirmed region header, bad preset density |
| Exact allowlist | Insufficient export tokens, no valid license, empty manufacturing output, lease expired, G-code-only refusal, bad STL key, milled order, storage unavailable, Supabase admin missing, charge failed |

Everything else becomes `Manufacturing failed`. The test at `cad-operator-production.test.ts` lines 393–399 locks that in: `patient Jane Doe loft exploded` is stored as the generic sentence.

Swallowed sentences that can still be thrown on the live path:

- `VertexSlice error (status): …` (`vertexslice-client.ts` lines 717–723). A 422 is rewritten to a `Regional hardness…` sentence only when modifier regions were sent. Any other status stays in this form and is then swallowed.
- `VertexSlice returned empty G-code` (lines 740–744). The allowlist has `Manufacturing service returned empty output`, which is a different sentence.
- `Could not reach VertexSlice (url): …` (lines 468–471).
- `Material {id} not available on slicer` (`materialUnavailableMessage`, lines 35–39).
- `VERTEXSLICE_SLICER_URL is not set`, `VERTEXSLICE_API_KEY is not set`, unrecognized `/v1/materials` payload, locked-profile and material-id refusals, infill outside 5–100.
- `Hardness 3MF export failed: …` (`vertex/src/lib/hardness/pipeline.ts` lines 80–94).
- `manifold-3d rejected mesh for …` and `manifold-3d subtract failed for …` (`resolve.ts` lines 75–107).
- `3MF missing …`, `binary STL truncated`, and other pack/parse errors in `export-3mf.ts` / `mesh.ts`.
- A platform timeout whose error is not an `AbortError` or `TimeoutError`. `armSliceDeadline` (lines 409–418) aborts with `TimeoutError`, and that path is stored as `VertexSlice timed out after Ns (right)`. A different timeout message falls through `throwIfDeadline` (lines 437–449) into the generic sentence. If the isolate is frozen before `catch`, the row stays `running` until a later read sets `Production lease expired` (lines 189–203). That is a different stored sentence.

Headless loft failures are wrapped before they reach `markFailed`. `buildHeadlessFinalizedFoot` (`finalized-mesh-runner.ts` lines 97–121) turns them into `Canonical Export mesh is not available headless (Name: message). Refusing to substitute a different mesh.` `materializeCadOperatorStl` rethrows that message (`manufacturing-cad.ts` lines 234–246). `publicProductionError` keeps the Canonical Export sentence and a sanitized cause. A leader abort (`LeaderBlockOrientationError`, default text “the max-X end is not the thinner toe”, `leader-block.ts` lines 32–36 and 154–156) is inside that wrap. It would not be stored as `Manufacturing failed`.

Regional 3MF is built after that wrap (`manufacturing-cad.ts` lines 253–259). Those throws are not Canonical Export errors. They hit the fallback unless they already start with `Regional hardness`.

Device hardness Hard is gyroid 32% (`hardness-class-table.ts` lines 75–76; `infillPctForCadSlice` test in `cad-operator-production.test.ts` lines 442–444). Medium is 26%. The same percent is sent for both feet. A catalog met pad does not get `hardnessClass` (`saved-design-snapshot.ts` lines 761–771). `effectiveHardnessRegions` (`collect.ts` lines 59–63) drops element regions unless `splitElements === true`. Hard on the print recipe alone does not create a modifier volume. Modifier volumes exist only when that flag is on, or when `printRecipe.zones` has a non-element region.

Right-foot met-pad placement for a catalog element uses `defaultElementPose` → `meshYForAnatomicalSide` with `ELEMENT_PROFILES.met_pad.anatomicalSide = "medial"` (`elements.ts` lines 102–111 and 583–607). Medial mesh Y is −Y on the left and +Y on the right. The catalog path does not use a private `side === "left" ? -1 : 1`.

US Men’s 5 foot length is `(5 + 22) × (25.4 / 3)` mm (`shoe-size.ts` lines 18 and 60–62), about 228.6 mm, against the Men’s 9 reference of about 262.5 mm. The insole is scaled down from the 260×95 mm template. A smaller solid is the opposite of the oversized-mesh stall fixed in #325. Hard infill is denser than Medium, and the 20 mm leader is a larger fraction of a short foot, but the triangle cap and the classified timeout would both be stored as their own sentences.

### Inference

The right row’s catch ran, and the thrown message missed the allowlist. Left success on the same design rules out shared configuration: missing slicer URL or key, material not listed, locked-profile refusal, license, tokens, and storage configuration. Those would have failed the left row the same way, or would have been stored as an allowlisted sentence (`Insufficient export tokens` if the left charge drained the balance).

Ranked causes for `77a8274e`:

1. **VertexSlice rejected the right mesh with a non-allowlisted status** (leading). The right solid is the mirrored foot. Local STL inspection only checks finite coordinates, a majority of degenerate triangles, extent, and triangle count. A non-manifold or self-intersecting solid under the simplify threshold is still posted. The slicer answer `VertexSlice error (500): …` (or 400/502 that is not a regional 422) is stored as `Manufacturing failed`. The raw detail is in the Vercel log on `[vertexslice] slice failed` and in the production stack. Bilateral met pad, high arch (+3 mm), and the leader are all in that mesh. This does not require a Nov 12 behavior change; it requires the right mesh to be something the slicer refuses.

2. **Right-only modifier volume, and only if this design has regions.** If `settingsJson.settings.splitElements` is true, or a zone/freehand region exists on the right, `exportHardness3mf` / manifold can throw `Hardness 3MF export failed` or `manifold-3d rejected mesh`. Those become the generic sentence. #334 (`a3b965e3`, 2026-11-12, “Send regional hardness modifiers to VertexSlice”) is the merge that puts this path on direct G-code. It is not in the requested PR list and it is the manufacturing change that can fail one foot after a successful loft. Device Hard alone does not enter this path.

3. **Unclassified timeout or reachability error.** Possible, weaker for Men’s 5 than for a large foot. A classified timeout would read `VertexSlice timed out after Ns (right)`. Confirm only from the log line, not from the row.

4. **Upload after a successful slice.** A storage error that is not `Storage not available` or `Invalid manufacturing STL storage key` is also swallowed. Less likely once the left upload succeeded, unless the right object key or body specifically failed.

### Nov 12 merges, against this failure

| PR | What it touches | Could it store this sentence on the right only? |
| --- | --- | --- |
| #334 (adjacent, same day) | Regional 3MF on the CAD-operator slice | Yes, if this design has modifier regions and the right volume fails. |
| #341 | Long bottom-name engrave manifold | The loft throw would be a Canonical Export sentence. A mesh that lofts and then gets a slicer 500 would look like hypothesis 1. Right text is mirrored, so it is a possible contributor, not the thing that chooses the generic sentence. |
| #327 | Arch ease forced to 0; arch elongation added | Does not zero arch height or apex. Changes the solid on both feet. A right-only slicer reject would still be hypothesis 1. |
| #325 (adjacent) | Oversized STL stall / simplify | Men’s 5 is smaller than the template. A simplify failure is stored as `Manufacturing mesh is not sliceable…`. |
| #319 | Apex Forge enabled | Only if the right call used a material the slicer then rejected. That sentence is swallowed, but it is not foot-specific. Left success means the material was listed for that run. |
| #318 | Export filenames `First_Last_Material_L\|R` | Runs after the slice, on the upload name. Unlikely to fail one side. A thrown filename or storage error would be generic. |
| #340 | Manufacturing read access aligned with design save | Denies with `Production not found or access denied` before a failed manufacturing row. Preflight token and license errors are allowlisted. |
| #345 | Stale-build export gate | Client only. Message is `OrthoCAD was updated. Reload to export with the latest version.` (`export-build-gate.ts` line 7). It returns before `generateSolid`. It does not write `productions.error`. |
| #346 | 30 min idle logout, re-auth modal, export-busy flag | Does not slice and does not set this error. The busy flag keeps the session alive during a client export. |
| #343 | Shoe-size dropdown on the client chart and new-insole start | UI only. No manufacturing path. |
| #342, #338, #339, #349 | AFO markers, trim, flat plate | Not on the insole loft or VertexSlice handoff. |
| #335 | Round grinding with Reverse Morton’s plus Cluffy | This order is a met pad, not that pair. |
| #329 | Login logo | No. |

#316 and #320 (2026-11-11) already classify the slice abort as `VertexSlice timed out after…`. A timeout that went through that path is not this row.

### Proposed fix (later PR)

Keep the public row free of names, settings JSON, secrets, and G-code, and stop collapsing the operational sentences above. In `publicProductionError`, preserve:

- `VertexSlice error (NNN):` plus a length-capped detail that already passes the existing redaction
- `VertexSlice returned empty G-code`
- `Could not reach VertexSlice` without the URL
- `Hardness 3MF export failed` and `manifold-3d rejected` / `manifold-3d subtract failed`, length-capped
- `Material … not available on slicer`

Add one test next to the Jane Doe case that a `VertexSlice error (500):` message survives. Do not repin goldens.

Recommended model: **Composer 2.5**. The change is the allowlist and its tests.

Do not start a geometry PR until the log names a right-mesh defect. If it does (leader orientation is already visible and was not this row; a met-pad boolean or mirrored text is the likely defect), that PR is separate and should be **Grok 4.7**, limited to the cited solid or element path.

### What has to happen for order `05ee4711` to ship

1. Read the log for production id prefix `77a8274e` before any retry. Search `[manufacturing] cad production failed` and `[vertexslice] slice failed`. The stack is the diagnosis. Do not copy chart text out of it.
2. Run the query in the check section. Confirm left `7f863b8d` is `succeeded` with a G-code key, and that it was charged. Leave it. A repeat with the same settings reuses that row and does not slice or charge again.
3. If the log is a transient slicer or network error, retry the right foot only, same design settings, same material and preset. `decideClaim` reruns a `failed` row in place. A successful retry charges once (`HYBRID_GCODE_COST` is 3). A failed retry is not charged.
4. If the log is a right-mesh or manifold error, a retry fails the same way. Ship the right foot after the geometry fix, then retry once.
5. This PR does not retry anything and does not write production.

### Production check (read-only)

IDs in the request are 8 hex characters. Match the prefix and stop if more than one row matches. Do not select `name`, `notes`, `textMarking`, or client columns.

```sql
SELECT id,
       side,
       status,
       error,
       "presetId",
       material,
       "layerHeightMm",
       "beltAngleDeg",
       ("gcodeStorageKey" IS NOT NULL) AS has_gcode,
       ("chargedAt" IS NOT NULL) AS charged,
       "createdAt",
       "updatedAt"
FROM productions
WHERE id::text LIKE '77a8274e%'
   OR id::text LIKE '7f863b8d%'
   OR "designId"::text LIKE '860ba9f8%';
```

```sql
SELECT ("settingsJson"->'settings'->>'splitElements') AS split_elements,
       jsonb_array_length(COALESCE("settingsJson"->'settings'->'printRecipe'->'zones', '[]'::jsonb)) AS zone_count,
       ("settingsJson"->'settings'->'printRecipe'->>'defaultHardness') AS device_hardness,
       ("settingsJson"->'settings'->>'usMenSize') AS us_men_size,
       jsonb_array_length(COALESCE("settingsJson"->'settings'->'elements', '[]'::jsonb)) AS element_count
FROM designs
WHERE id::text LIKE '860ba9f8%';
```

`split_elements` true, or `zone_count` > 0, promotes hypothesis 2. Otherwise the log should be a slicer or network error (hypothesis 1 or 3).

---

## Problem 2 — design `efc8111d` arch, apex, and hardness reset

Arch raise, apex shift, and hardness went back to defaults sometime between 2026-11-11 and 2026-11-12. They were later put back as catalog `high`, `flexible_foot`, and `Medium`.

Those three catalog keys are exactly the three fields:

| Catalog | Stored field | Value when the key is sent | Value when the key is omitted |
| --- | --- | --- | --- |
| `arch: "high"` | `corrections.{left,right}.archHeightMm` | +3 mm (`ARCH_HEIGHT_MM`, `saved-design-catalog.ts` lines 8–14) | 0 |
| `flexible_foot: true` | `corrections.{left,right}.apexMoveMm` | +4 mm (`FLEXIBLE_FOOT_APEX_MM`) | 0 (`false` is the same as omitted) |
| `hardness: "Medium"` | `printRecipe.defaultHardness`, plus `dogfoodManufacturing.hardness` | Medium, `hardnessSource: "prescribed"` | Medium from the template, `hardness: null`, `hardnessSource: "unspecified"` |

Medium is also the template default (`DEFAULT_PRINT_RECIPE_V1`, `print-recipe.ts` lines 47–52). After a snapshot omit, the recipe still says Medium, and `dogfoodManufacturing.hardnessSource` is `unspecified`. After the manual re-apply, source should be `prescribed`.

### Verified writers

**1. Snapshot replace. This is the only writer that zeros all three together while keeping whatever else the catalog repeated.**

`buildSavedDesignSnapshot` (`vertex/shared/saved-design-snapshot.ts` lines 606–812) starts from `bareSampleTopDesign()` (lines 59–102): arch 0, apex 0, `migratePrintRecipe(undefined)` which is Medium, Men’s 9, no elements, no `dogfoodManufacturing` until the function sets it. Arch, apex, and hardness are copied only when the catalog includes them (lines 654–669, 701–712). The comment on line 608 says omitted clinical inputs stay at the unmodified template.

`persistSavedDesignSnapshotOnDesign` (`vertex/server/src/lib/saved-design-snapshot.ts` lines 182–205) replaces `designs.settingsJson` and no other column. It does not read the previous clinical values. It does not call `vertex_save_design`. It does not insert `audit_logs`. The test “null settingsJson is replaced in place” (`saved-design-snapshot.test.ts` lines 67–97) shows an omitted catalog stores arch 0, apex 0, no elements, and `hardness_source: "unspecified"`.

`create_saved_design` uses that same function and passes the request catalog through (`manufacturing.ts` lines 461–466). A refresh of an existing order with a partial catalog replaces the whole snapshot. `rx_text`, `notes`, `rigidity`, and `extra_soft` are ignored (`saved-design-catalog.ts` lines 45–46). Putting “arch high” or “flexible foot” in free text does not preserve the fields, and it also does not set them (test at `saved-design-snapshot.test.ts` lines 90–105).

There is no other MCP design-update tool. The catalog on `persist_saved_design_snapshot` and `create_saved_design` is the partial-payload path.

**2. Editor save of a default design. Zeros the three fields and also zeros elements, shoe size (back to Men’s 9), and writes an audit row.**

`defaultDesign()` (`design-store.ts` lines 224–248) is arch 0, apex 0, Medium, US Men’s 9, `elements: []`, and no `dogfoodManufacturing`.

Paths that can persist that object onto an existing design id:

- Autosave in `EditorChrome` (lines 115–147). On any design-store change it waits 800 ms and calls `saveDesign` with the store’s latest design. The effect arms as soon as the design record exists, which is before `hydrateDesignForEditor` returns.
- `reloadAppAfterSave` (`app-version-reload.ts` lines 17–29), added in #345 on 2026-11-12. If `activeDesignId` is set and the design store differs from the client-store record, it saves the store, then reloads.
- Explicit Save (`SaveControl.tsx`).

`design.save` → `saveDesignGeometry` updates `settingsJson` and calls `vertex_save_design` (`prisma-client-file-repo.ts` lines 280–304). The RPC rewrites `corrections` and `elements` and inserts `audit_logs` action `design_updated` (`phase_f_design.sql` lines 147–164). Missing `archHeightMm` inside that RPC is stored as 0.

How the store becomes the default while a saved design is open:

- Zustand persist `merge` (`design-store.ts` lines 1651–1669). If the persisted design has any elements, the active design is replaced with `createDesignWithStockPlaceholder()` (the full default) and the real design is held in `pendingSessionDesign` until Resume. The test “session reload holds placements aside” expects `design.elements` to become `[]`. Arch, apex, and hardness go with that replacement because the replacement is `defaultDesign()`, not a copy of the corrections.
- Directory load (`client-store.ts` lines 320–330, #288, 2026-11-09). For each design, state is the in-memory local copy or `createDesignWithStockPlaceholder()`. The list response is not parsed into clinical settings.
- `hydrateDesignForEditor` (`client-actions.ts` lines 192–209). A successful `design.get` with `settingsJson` returns the saved design (`design-document.ts` lines 94–96). If `design.get` throws, and the session state has no elements, it returns `createDesignWithStockPlaceholder(sessionState)`. A directory placeholder has no elements, so a failed get loads the default. Autosave can then write it.
- `loadDesign` itself keeps saved arch, apex, and hardness. `migratePrintRecipe` returns Medium only when the recipe is missing or fails the schema (`print-recipe.ts` lines 92–115). `migrateSideCorrections` (`migrate-corrections.ts` lines 35–54) folds arch fill into arch height and forces `archEaseMm` to 0. It does not change `archHeightMm` when arch fill is already 0, and it does not change `apexMoveMm`.

**3. Manufacturing text-marking update. Not a reset.**

`resolveProductionTextMarking` (`integration-text-marking.ts` lines 88–114) merges text into the existing settings object and can `UPDATE` `settingsJson` (`manufacturing-cad.ts` lines 176–180). It spreads the existing settings. It does not rebuild from `bareSampleTopDesign()`.

### Ranked

1. **Partial `persist_saved_design_snapshot` or `create_saved_design`.** Best match for “these three fields, later put back as `high`, `flexible_foot`, `Medium`.” Omitted keys become template defaults; keys the caller did send (shoe size, met pads, sliders) stay. No `design_updated` audit. `settingsJson` changes and the `corrections` / `elements` tables do not. After the manual re-apply, `dogfoodManufacturing.hardnessSource` should be `prescribed` and arch/apex should be 3 and 4 again. The intermediate JSON is gone unless the database has point-in-time history. `updatedAt` only shows the last writer.

2. **Editor autosave or the #345 reload save, of the default store.** Same three clinical defaults, plus Men’s 9, empty elements, no `dogfoodManufacturing`, and an `audit_logs` row `design_updated` in the window. #345 is the new writer on 2026-11-12: the version banner saves whatever is in the design store. The persist-merge and the directory placeholder are older; they become a save only when autosave or #345 runs before hydrate finishes, or when `design.get` fails and hydrate returns the placeholder.

3. **#346 as a trigger for (2), not as its own writer.** Re-auth (`useAuthBootstrap.ts` lines 121–131, `auth-session-resilience.ts` lines 69–79) does not write settings. A failed refresh leaves `design.get` able to throw. Hydrate then falls through to the placeholder, and autosave can persist it. Rank this under (2) if the audit row exists and the session logs show `[auth] session lost — re-auth required` in the same window.

4. **#327 arch-ease migration.** Sets `archEaseMm` to 0 on load. Does not set arch height, apex, or hardness. It does not explain a later re-apply of `high` and `flexible_foot`.

5. **#343 shoe-size dropdown.** Client chart and new-insole start (`NewClientDialog.tsx`, `StartInsole.tsx`, `ShoeSizeSelect.tsx`). `setUsShoeSize` on an open design scales layout and keeps correction millimeters (`design-store.ts` lines 771–782). #343 does not call it. Starting a new insole creates a new design id. It does not write `efc8111d`.

6. **Migrations.** No SQL migration rewrites `settingsJson` clinical fields. `vertex_save_design` defaults a missing arch height to 0 only when the UI save path runs.

7. **`migratePrintRecipe` alone.** Can turn a recipe that fails schema parse into Medium. It does not zero arch or apex. It is not sufficient for this report.

### Proposed fix (later PRs, separate)

**PR A, snapshot.** In `buildSavedDesignSnapshot` / `persistSavedDesignSnapshotOnDesign`, an omitted `arch`, `flexible_foot`, or `hardness` keeps the stored value. An explicit key still replaces it. An empty catalog must not rebuild clinical fields from `bareSampleTopDesign()`. Add a test that a second persist with only `shoe_size` leaves arch +3, apex +4, and `hardnessSource: "prescribed"`. Recommended model: **Composer 2.5**.

**PR B, editor.** Do not autosave and do not run `reloadAppAfterSave` until `hydrateDesignForEditor` has applied `design.get`. A failed get must not `saveDesign` the directory placeholder. Recommended model: **Composer 2.5**.

Do PR A if the check shows a settings-only write. Do PR B if the check shows `design_updated`. They fix different writers. Neither belongs in this PR.

### Production check (read-only)

```sql
SELECT d."updatedAt",
       (d."settingsJson"->'settings'->'corrections'->'left'->>'archHeightMm') AS left_arch_mm,
       (d."settingsJson"->'settings'->'corrections'->'right'->>'archHeightMm') AS right_arch_mm,
       (d."settingsJson"->'settings'->'corrections'->'left'->>'apexMoveMm') AS left_apex_mm,
       (d."settingsJson"->'settings'->'corrections'->'right'->>'apexMoveMm') AS right_apex_mm,
       (d."settingsJson"->'settings'->'printRecipe'->>'defaultHardness') AS recipe_hardness,
       (d."settingsJson"->'settings'->'dogfoodManufacturing'->>'hardness') AS recorded_hardness,
       (d."settingsJson"->'settings'->'dogfoodManufacturing'->>'hardnessSource') AS hardness_source,
       (d."settingsJson"->'settings'->>'usMenSize') AS us_men_size,
       (d."settingsJson"->'settings'->'dogfoodManufacturing' IS NOT NULL) AS has_dogfood_block,
       jsonb_array_length(COALESCE(d."settingsJson"->'settings'->'elements', '[]'::jsonb)) AS settings_element_count
FROM designs d
WHERE d.id::text LIKE 'efc8111d%';
```

```sql
SELECT side, "archHeightMm", "apexMoveMm", "archEaseMm", "archElongationMm"
FROM corrections
WHERE "designId"::text LIKE 'efc8111d%';
```

```sql
SELECT side, kind
FROM elements
WHERE "designId"::text LIKE 'efc8111d%';
```

```sql
SELECT action, "createdAt", ("userId" IS NOT NULL) AS has_user
FROM audit_logs
WHERE "targetId"::text LIKE 'efc8111d%'
  AND "createdAt" >= TIMESTAMP '2026-11-11'
  AND "createdAt" < TIMESTAMP '2026-11-13'
ORDER BY "createdAt";
```

How to read it:

- `design_updated` in that window, `us_men_size` 9, `settings_element_count` 0, `has_dogfood_block` false: editor save of `defaultDesign()` (hypothesis 2). Compare `corrections` / `elements`; `vertex_save_design` rewrites both, so they should match the JSON.
- No `design_updated`, JSON arch/apex at the re-applied 3 mm / 4 mm, `hardness_source` `prescribed`, and the `corrections` or `elements` rows still show an older combination: the last writer was a snapshot (hypothesis 1). The reset itself is the snapshot that ran before the manual re-apply. Point-in-time recovery is the only way to see that intermediate JSON.
- `archEaseMm` 0 with arch height and apex still at the clinical values: #327 only. That is not this incident.
- Stop if the prefix matches more than one design. Do not select names, notes, or `textMarking`.
