// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { ProductionMethod, Side } from "@/types";

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
