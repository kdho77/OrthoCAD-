// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { setProductType } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

/** Start-of-case Insole vs AFO switcher. Shared viewer stays mounted. */
export function ProductTypeBar() {
    const product = useClinicalWorkflowStore((s) => s.productType);
    const setWorkflowProduct = useClinicalWorkflowStore((s) => s.setProductType);
    const designProduct = useDesignStore((s) => s.design.productType ?? "insole");

    useEffect(() => {
        if (designProduct !== product) setWorkflowProduct(designProduct);
    }, [designProduct, product, setWorkflowProduct]);

    const choose = (next: "insole" | "afo") => {
        if (next === product) return;
        setWorkflowProduct(next);
        setProductType(next, useDesignStore.getState().exportSide);
    };

    return (
        <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Product
            </span>
            <div className="flex rounded-md border border-border p-0.5">
                {(["insole", "afo"] as const).map((id) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => choose(id)}
                        className={cn(
                            "rounded px-2.5 py-1 text-[11px] font-medium",
                            product === id
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {id === "insole" ? "Insole" : "AFO"}
                    </button>
                ))}
            </div>
        </div>
    );
}
