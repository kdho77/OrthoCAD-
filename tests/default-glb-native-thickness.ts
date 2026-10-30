// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { deriveNativeShellThicknessDatum } from "@/lib/geometry/native-shell-thickness";

/** Labelled thickness that yields zero thickness-datum offset on Default.glb. */
export function nativeThicknessMmForDefaultGlb(base: BufferGeometry): number {
    return deriveNativeShellThicknessDatum(base)?.nativeMinClearanceMm ?? 3;
}
