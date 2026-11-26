# Independent grade: PR #468

**Graded commit:** `72347f76bce9864c70ef25342ee8d3dc4b22b4c7`  
**Worker PR:** [#468](https://github.com/kdho77/OrthoCAD-/pull/468) (draft, do not merge)  
**Grader branch:** `cursor/grade-pr-468-scan-last-1125`  
**Verdict:** **PASS**

## Gate table

| Gate | Result | Evidence |
|------|--------|----------|
| ONE: explicit option builds from order scans like UI | PASS | `design-from-order-scans.ts` calls `importFootScanFile` + `generateOrthoticFromScanAndRx`; grader test `headless scan path shares importFootScanFile…`; worker test arch 30/20 → +3 / −3.5 mm |
| Default template-based, byte-identical | PASS | `buildSavedDesignSnapshot` sets `scansUsed: false` (`saved-design-snapshot.ts` L752–754); SHA-256 `f5d8b161…` on US_M 9 envelope (grader + worker tests) |
| MUST-MATCH: headless SAMPLE_Top, scansUsed false unless opt-in | PASS | `applyRequestedOrderScans` no-op unless `useOrderScans === true`; MCP forwards flag only when true |
| Optional per-design only (not production default) | PASS | Omit/false: loader not called; README + MCP tool descriptions |
| Documented (MCP + README) | PASS | `packages/mcp/README.md`, `schemas.ts` `use_order_scans` on create/persist |
| Register tests in `ci/unit-test-shards.json` | PASS | `design-from-order-scans.test.ts` on shard 2; grader adds `grade-pr-468-independent.test.ts` |
| Production path = UI export, rebuild from saved design | PASS | Option only mutates `settingsJson`; loft path unchanged; no STL/checkpoint read in diff |
| Design change invalidates cached STL/G-code | PASS | `cadOperatorManufacturingIdentity` hashes `settingsJson` (grader fingerprint test) |
| Patient name engraved (both feet) | PASS | No `textMarking` changes in PR diff |
| No outer surface / seam / layer-quality change (default path) | PASS | Default path unchanged; scan option adjusts arch slider only |
| Copy conventions, do not invent clinical magnitudes | PASS | Arch bands from `generateOrthoticFromScanAndRx`; `design-from-order-scans.ts` has no literal arch assignments (grader source check) |
| Draft only, never merge/deploy | PASS | PR #468 `draft: true` |
| G-scope | PASS | `git diff 228c72f2..72347f76` = 19 brief-listed files (grader scope test) |
| G-invent | PASS | No new clinical constants in new modules |
| G-CI | PASS | GitHub Actions on `72347f76`: unit-tests 1–6, isolated-postgres-acceptance, test-and-deploy, plantar-name — all success |

## Independent tests run (grader)

```bash
node scripts/ci/validate-unit-test-shards.mjs
npx rstest vertex/src/lib/clinical/grade-pr-468-independent.test.ts
npx rstest vertex/src/lib/clinical/design-from-order-scans.test.ts
npx rstest vertex/server/src/lib/saved-design-snapshot.test.ts -t useOrderScans
npx rstest packages/mcp/test/dogfood-order-identity.test.ts -t use_order_scans
```

## Residuals (accepted, from worker PR body)

- Scans come from `client_scans` on the bound client, not a new VO download.
- Multi-component scans without approval → 422 (same as UI).
- Sub-18 mm arches reported in `scan_review` like Generate Orthotic.

## Hash / baseline audit

- Template envelope hash **added** (not loosened): new lock `f5d8b161…` for default path.
- Hosted MCP bundle banner updated to match `orthocadMcpHttpSourceHash()` (geometry/source change, not arbitrary re-pin).
- No removed or weakened expectations in unrelated tests on this diff.