import { Check, Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuditStore } from "@/stores/audit-store";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";

// Saves the design that was opened from a client file. There is no path here
// that creates a client or a design on its own.
export function SaveControl() {
    const [saved, setSaved] = useState(false);
    const activeDesignId = useClientStore((s) => s.activeDesignId);
    const designs = useClientStore((s) => s.designs);
    const record = designs.find((design) => design.id === activeDesignId);

    const onSave = () => {
        if (!activeDesignId) return;
        useClientStore.getState().saveDesign(activeDesignId, useDesignStore.getState().design);
        useAuditStore.getState().record("design_saved", record?.name ?? "Saved design");
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    return (
        <div className="flex items-center gap-2">
            {record ? <span className="max-w-[140px] truncate text-xs text-muted-foreground">{record.name}</span> : null}
            <Button size="sm" variant="outline" onClick={onSave} disabled={!activeDesignId} className="min-h-11">
                {saved ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Save className="h-3.5 w-3.5" />}
                {saved ? "Saved" : "Save"}
            </Button>
        </div>
    );
}
