// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    type ApexPrintMaterialId,
    DEFAULT_APEX_PRINT_MATERIAL_ID,
    lockedProfileIdForApexMaterial,
} from "@/features/exports/apex-print-material";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import type { DesignState, ProductionMethod, Side } from "@/types";
import {
    MANUFACTURING_SOLID_GEOMETRY_VERSION,
    type ManufacturingSolidContext,
} from "./manufacturing-solid-cache";

export const DEFAULT_MANUFACTURING_MACHINE_ID = `printing_solid:${lockedProfileIdForApexMaterial(
    DEFAULT_APEX_PRINT_MATERIAL_ID,
)}`;

export interface ManufacturingSliceTarget {
    productId: string;
    machineId: string;
}

let sliceTarget: ManufacturingSliceTarget = {
    productId: DEFAULT_APEX_PRINT_MATERIAL_ID,
    machineId: DEFAULT_MANUFACTURING_MACHINE_ID,
};

export function manufacturingSliceTarget(): ManufacturingSliceTarget {
    return { ...sliceTarget };
}

export function setManufacturingSliceTarget(next: ManufacturingSliceTarget): void {
    sliceTarget = { productId: next.productId, machineId: next.machineId };
}

export function resetManufacturingSliceTarget(): void {
    sliceTarget = {
        productId: DEFAULT_APEX_PRINT_MATERIAL_ID,
        machineId: DEFAULT_MANUFACTURING_MACHINE_ID,
    };
}

/** Machine half of the fingerprint: method plus the locked slicer profile. Core's profile id is not edited here. */
export function manufacturingMachineId(method: ProductionMethod, productId: ApexPrintMaterialId): string {
    return `${method}:${lockedProfileIdForApexMaterial(productId)}`;
}

export function manufacturingCacheContext(input: {
    design: DesignState;
    side: Side;
    baseAssetId: string;
    mirrored: boolean;
    printLoftEpoch?: number;
}): ManufacturingSolidContext {
    const target = manufacturingSliceTarget();
    return {
        side: input.side,
        mirrored: input.mirrored,
        baseAssetId: input.baseAssetId,
        printLoftEpoch: input.printLoftEpoch ?? usePreviewLoftStatusStore.getState().printLoftEpoch,
        productId: target.productId,
        machineId: target.machineId,
        geometryVersion: MANUFACTURING_SOLID_GEOMETRY_VERSION,
    };
}
