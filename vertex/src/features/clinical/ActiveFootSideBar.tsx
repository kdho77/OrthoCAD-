// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Button } from "@/components/ui/button";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { SIDE_LABELS, type Side } from "@/types";

/** L/R selector aligned with viewer target and shape-finish edits (clinical rail #168 compatible). */
export function ActiveFootSideBar() {
    const active = useActiveFootSide();
    const setExportSide = useDesignStore((s) => s.setExportSide);
    const setTarget = useMeshEditStore((s) => s.setTarget);

    const pickSide = (side: Side) => {
        setExportSide(side);
        setTarget({ type: "insole", side });
    };

    return (
        <div className="flex gap-1">
            {(["left", "right"] as Side[]).map((s) => (
                <Button
                    key={s}
                    size="sm"
                    variant={active === s ? "default" : "secondary"}
                    className="h-8 flex-1 text-[11px]"
                    onClick={() => pickSide(s)}
                >
                    {SIDE_LABELS[s]} foot
                </Button>
            ))}
        </div>
    );
}
