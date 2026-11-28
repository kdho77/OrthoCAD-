# Thickness-mode gates (frozen)

Independent grade of worker draft PR #403 (`cursor/thickness-mode-1123` @ `3dd73e97bdcfe0cefeac531ace243f7c46c9ab14`) against base `main` @ `268aac85847160b5b2703a05688721ea4cb93b24`.

These files are the gates. They are frozen before the candidate is graded. Do not edit gate sources after the freeze commit. `RESULTS.md` is the grade table written by `run-gates.mjs grade` and is not a gate.

The gates call the repo's `buildSavedDesignSnapshot` → `settingsEnvelopeForSave` → `readStoredDesignSettings` path. That is the settings document `create_saved_design` stores and `get_design_params` reads back. No product code is modified.

```
node validation/thickness_mode_gates/run-gates.mjs proofs
node validation/thickness_mode_gates/run-gates.mjs grade
```

`proofs` runs each gate on a no-op copy and on a deliberately broken copy of base. `grade` reruns those proofs, then grades base and the candidate. `grade` refuses to run if a gate source hash differs from `freeze-manifest.json`.
