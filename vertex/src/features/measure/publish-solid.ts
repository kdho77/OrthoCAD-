// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect } from "react";
import type { BufferGeometry } from "three";
import { publishMeasureSolid } from "@/lib/geometry/measure/registry";
import type { MeasureProduct, MeasureSide } from "@/lib/geometry/measure/types";

/** Keep the viewer's solid registered for overall size and reprojection. */
export function usePublishMeasureSolid(
    id: string,
    geometry: BufferGeometry | null,
    product: MeasureProduct,
    side: MeasureSide,
    revision: string,
): void {
    useEffect(() => {
        if (!geometry) return;
        void revision;
        return publishMeasureSolid({ id, geometry, product, side });
    }, [geometry, id, product, side, revision]);
}
