import { Check, Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuditStore } from "@/stores/audit-store";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";

// Header save control: persists the live design into the active client/design,
// creating a quick client/design if none is active. Local-first; mirrors to the
// server via design.save when the API is configured (Phase 5).
export function SaveControl() {
    const [saved, setSaved] = useState(false);
    const activeDesignId = useClientStore((s) => s.activeDesignId);
    const activeClientId = useClientStore((s) => s.activeClientId);
    const designs = useClientStore((s) => s.designs);
    const { addClient, addDesign, saveDesign } = useClientStore.getState();

    const record = designs.find((d) => d.id === activeDesignId);

    const onSave = () => {
        const design = useDesignStore.getState().design;
        let designId = activeDesignId;

        if (designId) {
            saveDesign(designId, design);
        } else {
            let clientId = activeClientId;
            if (!clientId) clientId = addClient({ firstName: "Quick", lastName: "Client" });
            designId = addDesign(clientId, "Untitled design", design);
        }
        useAuditStore.getState().record("design_saved", record?.name ?? "Untitled design");
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    return (
        <div className="flex items-center gap-2">
            {record ? (
                <span className="max-w-[140px] truncate text-xs text-muted-foreground">{record.name}</span>
            ) : null}
            <Button size="sm" variant="outline" onClick={onSave}>
                {saved ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                    <Save className="h-3.5 w-3.5" />
                )}
                {saved ? "Saved" : "Save"}
            </Button>
        </div>
    );
}
