// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { deriveNativeShellThicknessDatum } from "@/lib/geometry/native-shell-thickness";

/** Labelled thickness that yields zero thickness-datum offset on Default.glb. */
export function nativeThicknessMmForDefaultGlb(base: BufferGeometry): number {
    return deriveNativeShellThicknessDatum(base)?.nativeMinClearanceMm ?? 3;
}
