// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Non-text triangle hashes of manufacturing STLs that already engrave a
// readable JABBOUR on BASE d20ca6e9. Quantized to 0.01 mm. A surface or
// seam edit outside the letter box changes the hash. A later text-only
// edit inside that box does not. Feet whose engrave is absent on BASE
// are not frozen: putting the name on them has to add triangles.

export const FROZEN_NON_TEXT_SHA256: Record<string, string> = {
    "control-442|left": "e7af23609fa92f120c9ae865bff0d2892229439dc8a6be42578b57b828f00d1f",
    "control-442|right": "627dbe2b8adfe53b627a97b00c01995da68ce099937fb23e5ec59174a099d20d",
    "ad1e0cc5|left": "1db4aca1ca2cef6552fd9a4880c44037120288b62c0fb2ff0fe2179645a161f2",
    "ad1e0cc5|right": "1fea2aab672e5128b3173a1c2adbdd45b763f3dd11619c5c6d627a07be8e34aa",
    "0d3db1c0|left": "8d0f499e7bdf89ac628c821edf8e49ac715344608a15ec217023203c360c2e08",
    "0d3db1c0-hard|left": "8d0f499e7bdf89ac628c821edf8e49ac715344608a15ec217023203c360c2e08",
    "0d3db1c0-linked|left": "8d0f499e7bdf89ac628c821edf8e49ac715344608a15ec217023203c360c2e08",
    "0d3db1c0-heel0|left": "8d0f499e7bdf89ac628c821edf8e49ac715344608a15ec217023203c360c2e08",
    "0d3db1c0-size12|left": "1db4aca1ca2cef6552fd9a4880c44037120288b62c0fb2ff0fe2179645a161f2",
    "0d3db1c0-size12|right": "7f198b4af1f45e454eae97cdbc77b4871e0617a85d562bbd283e975af4d73e3f",
    "ad1e0cc5-medium|left": "1db4aca1ca2cef6552fd9a4880c44037120288b62c0fb2ff0fe2179645a161f2",
    "ad1e0cc5-medium|right": "1fea2aab672e5128b3173a1c2adbdd45b763f3dd11619c5c6d627a07be8e34aa",
    "ad1e0cc5-unlinked|left": "1db4aca1ca2cef6552fd9a4880c44037120288b62c0fb2ff0fe2179645a161f2",
    "ad1e0cc5-unlinked|right": "1fea2aab672e5128b3173a1c2adbdd45b763f3dd11619c5c6d627a07be8e34aa",
    "ad1e0cc5-heel12|left": "1db4aca1ca2cef6552fd9a4880c44037120288b62c0fb2ff0fe2179645a161f2",
    "ad1e0cc5-heel12|right": "7f198b4af1f45e454eae97cdbc77b4871e0617a85d562bbd283e975af4d73e3f",
    "ad1e0cc5-size11.5|left": "8d0f499e7bdf89ac628c821edf8e49ac715344608a15ec217023203c360c2e08",
    "ad1e0cc5-pair|left": "1db4aca1ca2cef6552fd9a4880c44037120288b62c0fb2ff0fe2179645a161f2",
    "ad1e0cc5-pair|right": "1fea2aab672e5128b3173a1c2adbdd45b763f3dd11619c5c6d627a07be8e34aa",
};
