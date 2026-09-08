# AGPL / Upstream Disposition Memo

> **READ-ONLY planning memo — NOT legal advice; counsel required.**  
> This document is for internal planning and decision support only. It does not constitute legal advice and must not be relied upon for compliance, licensing, or commercial decisions without review by qualified counsel.

| Field | Value |
| --- | --- |
| **Repository** | [kdho77/OrthoCAD-](https://github.com/kdho77/OrthoCAD-) |
| **Tip SHA** | `21671fa229422063125fcbbb2144fca0e88644ca` |
| **Memo date** | 2026-09-08 |
| **Status** | Planning — disposition unresolved |

---

## 1. Purpose

Record the current evidence of AGPL/LGPL upstream lineage in the OrthoCAD- monorepo, frame the product context, enumerate disposition options, and recommend a near-term posture pending counsel review. **No licensing remediation is implied or authorized by this memo.**

---

## 2. Product framing

| Dimension | Description |
| --- | --- |
| **Product** | Web-based **OrthoCAD** — browser successor to the legacy **Windows OrthoCAD** (Rhino-based orthotic insole CAD workflow). |
| **Primary delivery** | `vertex/` — React + Vite frontend, tRPC backend, Supabase auth/storage, Prisma/Postgres, token-gated export and licensing. |
| **Organization priority** | **Softphone org P1** — disposition must be resolved before broader customer-facing rollout, external distribution, or SaaS scale. |
| **Business constraint** | Proprietary product layers (auth, billing, AI prescription, manufacturing pipeline, admin) sit alongside forked open-source geometry kernel code. |

---

## 3. Evidence of upstream lineage

The repository retains substantial **Chili3D** upstream artifacts. Key references (paths relative to repo root at tip SHA above):

| Evidence | Location | Notes |
| --- | --- | --- |
| **Chili3D README** | `README.md` | Describes Chili3D as open-source browser CAD; links upstream `xiangechen/chili3d`; states **AGPL-3.0** distribution. |
| **Root package identity** | `package.json` | `"name": "chili3d"`, version `0.7.0-beta`; monorepo workspaces under `packages/*`. |
| **AGPL license text** | `LICENSE` | Full **GNU Affero General Public License v3.0** text at repository root. |
| **LGPL WASM license** | `cpp/LICENSE-chili-wasm.txt` | **GNU Lesser General Public License v3.0** for the C++/Emscripten OpenCascade WASM module (`cpp/`). |
| **Vertex product fork** | `vertex/README.md` | Explicitly states **3D kernel: Forked Chili3D (OpenCascade WASM)** via `IGeometryKernel`; WASM build path references repo-root `npm run build:wasm` and `vertex/npm run prepare:wasm`. |
| **Chili3D packages** | `packages/*` | `@chili3d/core`, `@chili3d/wasm`, `@chili3d/three`, etc. — upstream package layout preserved. |
| **Type shims / integration** | `vertex/tsconfig.json` | Path aliases to `@chili3d/core` and `@chili3d/wasm` shims — confirms compile-time coupling to Chili3D APIs. |
| **Commercial upstream contact** | `README.md` (License section) | Upstream offers commercial licensing via `xiangetg@msn.cn`. |

**Implication (non-legal):** The codebase is not a clean-room reimplementation. It inherits AGPL-typed TypeScript/application code and LGPL-typed WASM artifacts from Chili3D, integrated into a proprietary OrthoCAD product shell in `vertex/`. Exact copyleft triggers (modification, distribution, network use, linking/combining) require counsel analysis.

---

## 4. Disposition options (planning only)

Each option below is a **planning scenario**, not a decision. Pros/cons are operational and strategic; legal viability must be confirmed by counsel.

### Option A — Internal-only / no external distribution (near-term hold)

**Summary:** Restrict use to internal development, QA, and authorized staff; no customer-facing SaaS, no binary/asset distribution outside the org, no public demos with live kernel.

| Pros | Cons |
| --- | --- |
| Buys time for counsel and negotiation without immediate public exposure | Does not resolve long-term product strategy |
| Lowest near-term engineering churn | Internal use may still implicate license terms — **not assumed safe without counsel** |
| Allows continued R&D on geometry and workflow | Blocks revenue, pilot customers, and Softphone P1 delivery |
| Preserves optionality for B–F later | Risk of "shadow" external use (demos, Vercel previews, contractor access) if not governed |

### Option B — Quarantine kernel (legal/compliance boundary)

**Summary:** Physically or logically isolate AGPL/LGPL kernel artifacts (separate repo, submodule, build artifact boundary) from proprietary application code; strict dependency direction and audit trail.

| Pros | Cons |
| --- | --- |
| Clarifies what is "upstream-derived" vs proprietary | High refactor cost; easy to get boundary wrong |
| May simplify future compliance narrative if combined with E or C | Quarantine alone does not eliminate copyleft — counsel must validate |
| Supports cleaner CI/license scanning | Delays feature work; WASM + worker threading complicates separation |
| Good documentation discipline for audits | Risk of accidental re-coupling via shared types, bundler graph, or monorepo imports |

### Option C — Negotiate commercial license with upstream (Chili3D)

**Summary:** Contact upstream maintainer(s) per README commercial licensing offer; seek proprietary/commercial license covering fork, modification, and SaaS distribution.

| Pros | Cons |
| --- | --- |
| Fastest path to lawful proprietary distribution **if** terms are acceptable | Cost, scope, and enforceability unknown until negotiated |
| Preserves existing engineering investment in fork | May not cover all dependencies (OCCT, third-party, future merges) |
| Upstream already advertises commercial licensing | Renewal, attribution, and audit clauses need counsel review |
| Enables customer-facing rollout without full open-sourcing | Failure of negotiation leaves timeline pressure on D or E |

### Option D — Replace upstream (clean-room or alternate kernel)

**Summary:** Migrate off Chili3D-derived code to a differently licensed geometry stack (e.g., licensed OCCT wrapper, alternate WASM CAD kernel, or service-based geometry API).

| Pros | Cons |
| --- | --- |
| Removes AGPL lineage from product **if** replacement is complete | Largest engineering effort and regression risk |
| Long-term clarity for investors and customers | Insole-specific OCCT pipeline (`occt-insole`, workers, export) must be revalidated |
| Freedom to choose permissive or commercial stack | Parallel run and migration may exceed near-term capacity |
| Reduces dependency on upstream maintainer | "Strangler" partial migration may prolong mixed-license exposure |

### Option E — Full AGPL compliance (open source corresponding source)

**Summary:** Treat OrthoCAD-/vertex as AGPL-covered combined work; publish source, offer corresponding source to users, comply with network-use (Section 13) obligations for SaaS.

| Pros | Cons |
| --- | --- |
| Aligns with upstream license text; no ambiguity about "hiding" kernel | Conflicts with proprietary business model (licensing, tokens, AI keys) |
| Community goodwill; potential upstream merge path | Exposes manufacturing, prescription, and client workflows |
| Clear compliance story once executed | Ongoing obligation to release modifications |
| May be acceptable for a subset of components only if counsel confirms severability | Softphone P1 commercial goals likely incompatible without major model change |

### Option F — Process-boundary / separate AGPL service

**Summary:** Run Chili3D-derived kernel as a distinct **AGPL-licensed service** (separate deployment, API boundary); proprietary client talks over network; AGPL source offered for the service component.

| Pros | Cons |
| --- | --- |
| Common pattern for copyleft + proprietary UI | **Legally contentious** — combining, derivative work, and "user interaction over network" need expert analysis |
| Keeps proprietary UI/auth/billing in separate repo | Latency, WASM-in-browser vs server-side geometry tradeoffs |
| May satisfy Section 13 for the service portion if structured correctly | Operational complexity (two deployables, versioning, export path) |
| Preserves some proprietary differentiation | Incomplete boundary (shared types, embedded WASM in browser) may defeat the model |

---

## 5. Architect recommendation (planning — not legal approval)

| Recommendation | Rationale |
| --- | --- |
| **Near-term: Option A** | Halt customer-facing and external distribution until disposition is counsel-approved. Continue internal R&D under strict access controls. |
| **Parallel: evaluate Option C with counsel** | Upstream explicitly offers commercial licensing; lowest engineering disruption **if** terms work. Engage counsel before contacting upstream. |
| **Hold B, D, E, F pending counsel** | Each carries significant legal and/or engineering cost; do not commit engineering rearchitecture until counsel rules on copyleft scope and Softphone P1 requirements. |
| **No customer-facing until disposition** | No production pilots, paid exports, or marketing demos using the Chili3D-derived kernel stack without written counsel sign-off on the chosen option. |

---

## 6. Recommended next steps

### For counsel

1. **Confirm copyleft scope** — Which repo paths constitute "Program" / combined work vs separable LGPL WASM library? Address browser-distributed WASM, workers, and tRPC server paths.
2. **Review distribution triggers** — Internal staff, contractors, Vercel preview URLs, Supabase-hosted assets, STL/GLB export delivery, and SaaS user access.
3. **Assess Option C** — Draft term sheet priorities (SaaS, modification, fork, attribution, audit) before upstream contact at `xiangetg@msn.cn` (per `README.md`).
4. **Rule on Option F viability** — If browser-embedded WASM cannot be process-separated, document dead ends early.
5. **Issue written disposition decision** — Single approved option (or hybrid with explicit boundaries) before customer-facing release.

### For COO

1. **Align Softphone P1 timeline** to disposition gate — treat external launch as blocked until counsel decision.
2. **Inventory exposure** — List all environments (Vercel, Render, Supabase, demo accounts) where OrthoCAD- artifacts are accessible outside core staff.
3. **Budget for Option C or D** — Commercial license fees vs replacement engineering; avoid implicit commitment to E without business model review.
4. **Communicate hold internally** — Sales/support must not promise GA dates tied to web OrthoCAD until disposition closes.

### For Kendon (engineering lead)

1. **Freeze external distribution artifacts** — Audit CI/CD, preview deployments, and shared links; restrict to internal allowlist if not already.
2. **Maintain evidence pack** — Keep this memo, tip SHA, and dependency graph current for counsel (no license headers remediation in this PR).
3. **Prepare Option C dossier** — Fork delta summary vs upstream `xiangechen/chili3d`, list of modified paths under `vertex/`, `packages/`, `cpp/`.
4. **Defer kernel quarantine (B) and replacement (D) scoping** until counsel selects path — avoid sunk refactor if C succeeds.
5. **Track upstream** — Monitor upstream releases and license text for changes affecting negotiation or compliance.

---

## 7. Document control

| Version | Date | Author | Notes |
| --- | --- | --- | --- |
| 0.1 | 2026-09-08 | Architecture (planning) | Initial memo at tip `21671fa` |

**Change policy:** Updates to this memo are docs-only. Licensing remediation, header changes, repo splits, and compliance implementation belong in separate counsel-approved workstreams.

---

*End of memo.*
