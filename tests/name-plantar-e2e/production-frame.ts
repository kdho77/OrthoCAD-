// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Live VertexSlice #52 preprocess (Y-negate before Rz270) composed with the
// locked belt forward already in belt-print-frame.ts. The #442 reading frame
// then sees the physical plantar face. This is not bottomimg.py.

import { beltPrintedPoint } from "@/lib/geometry/text-marking/belt-print-frame";
import { physicalReadingView, type Xyz, type Xy } from "./reading-view";

/** STL point → belt G-code XYZ after the live #52 Y-negate, Rz270, and belt forward. */
export function meshPointToGcode(p: { x: number; y: number; z: number }): Xyz {
    const belt = beltPrintedPoint({ x: p.x, y: -p.y, z: p.z });
    return { x: belt.across, y: belt.height, z: belt.along };
}

/** Same point in the #442 flip-the-device-over frame. heelHigh follows hand_classify. */
export function meshPointToReading(p: { x: number; y: number; z: number }, heelHigh: boolean): Xy {
    return physicalReadingView(meshPointToGcode(p), heelHigh);
}
