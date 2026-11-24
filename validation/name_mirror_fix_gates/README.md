# Plantar-face name chirality gates

Frozen gates for the bottom engraving. They do not change product code.

The acceptance camera is the physical plantar face: flip the device over and look through the belt toward +height. That view is the X flip of the right-handed face view. The gantry / from-above view already reads correctly on this base and is not acceptance.

Run:

```bash
npx rstest validation/name_mirror_fix_gates/gates.test.ts
```

`JABBOUR` is a synthetic string, not a patient name.
