// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ImportSideChoice, useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { ProductionMethod, Side } from "@/types";

export type { ImportSideChoice };

/** Shared L/R/Pair choice for the Scan step bar and scan import (no silent default). */
export function getImportSideChoice(): ImportSideChoice | null {
    return useClinicalWorkflowStore.getState().importSideChoice;
}

export function useImportSideChoice(): ImportSideChoice | null {
    return useClinicalWorkflowStore((s) => s.importSideChoice);
}

/**
 * One writer for the Scan step foot bar and the import side selector.
 * Left/Right also update export target; Pair marks both feet without a silent single-side default.
 */
export function setSharedFootSide(choice: ImportSideChoice): void {
    useClinicalWorkflowStore.getState().acknowledgeExplicitFootSide(choice);
    if (choice === "pair") return;
    useDesignStore.getState().setExportSide(choice);
    useMeshEditStore.getState().setTarget({ type: "insole", side: choice });
}

/** Active foot for placement and per-side production settings. */
export function getActiveFootSide(): Side {
    const target = useMeshEditStore.getState().target;
    if (target?.type === "insole") return target.side;
    if (target?.type === "element") {
        const el = useDesignStore.getState().design.elements.find((e) => e.id === target.id);
        if (el) return el.side;
    }
    return useDesignStore.getState().exportSide;
}

export function useActiveFootSide(): Side {
    const exportSide = useDesignStore((s) => s.exportSide);
    const target = useMeshEditStore((s) => s.target);
    const elements = useDesignStore((s) => s.design.elements);
    if (target?.type === "insole") return target.side;
    if (target?.type === "element") {
        const el = elements.find((e) => e.id === target.id);
        if (el) return el.side;
    }
    return exportSide;
}

export function productionMethodForSide(
    design: {
        method: ProductionMethod;
        paired?: { leftMethod: ProductionMethod; rightMethod: ProductionMethod };
    },
    side: Side,
): ProductionMethod {
    if (design.paired) {
        return side === "left" ? design.paired.leftMethod : design.paired.rightMethod;
    }
    return design.method;
}

export function useProductionMethodForActiveFoot(): ProductionMethod {
    const design = useDesignStore((s) => s.design);
    const side = useActiveFootSide();
    return productionMethodForSide(design, side);
}
