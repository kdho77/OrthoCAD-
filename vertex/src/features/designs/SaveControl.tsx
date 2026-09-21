import { Check, Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuditStore } from "@/stores/audit-store";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";

// Header save control: persists the live design into the active client/design.
// Prompts for client + design names when nothing is active (no silent Quick Client).
export function SaveControl() {
    const [saved, setSaved] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [designName, setDesignName] = useState("");
    const activeDesignId = useClientStore((s) => s.activeDesignId);
    const activeClientId = useClientStore((s) => s.activeClientId);
    const designs = useClientStore((s) => s.designs);
    const { addClient, addDesign, saveDesign } = useClientStore.getState();

    const record = designs.find((d) => d.id === activeDesignId);

    const persistDesign = (designId: string, label: string) => {
        const design = useDesignStore.getState().design;
        saveDesign(designId, design);
        useAuditStore.getState().record("design_saved", label);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    const onSave = () => {
        if (activeDesignId) {
            persistDesign(activeDesignId, record?.name ?? "Saved design");
            return;
        }
        setDesignName("");
        setFirstName("");
        setLastName("");
        setDialogOpen(true);
    };

    const onConfirmNewSave = () => {
        const trimmedDesign = designName.trim();
        if (!trimmedDesign) return;

        let clientId = activeClientId;
        if (!clientId) {
            const fn = firstName.trim() || "Client";
            const ln = lastName.trim();
            if (!ln) return;
            clientId = addClient({ firstName: fn, lastName: ln });
        }

        const designId = addDesign(clientId, trimmedDesign, useDesignStore.getState().design);
        useClientStore.getState().setActiveDesign(designId);
        persistDesign(designId, trimmedDesign);
        setDialogOpen(false);
    };

    const needsNewClient = !activeClientId;
    const canConfirm = designName.trim().length > 0 && (!needsNewClient || lastName.trim().length > 0);

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

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Save design</DialogTitle>
                        <p className="text-xs text-muted-foreground">
                            Name this design before saving.{" "}
                            {needsNewClient ? "Enter client details too." : "Saving under the active client."}
                        </p>
                    </DialogHeader>
                    <div className="space-y-2">
                        {needsNewClient ? (
                            <>
                                <Input
                                    placeholder="Client first name"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                />
                                <Input
                                    placeholder="Client last name (required)"
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                />
                            </>
                        ) : null}
                        <Input
                            placeholder="Design name (required)"
                            value={designName}
                            autoFocus={!needsNewClient}
                            onChange={(e) => setDesignName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && canConfirm) onConfirmNewSave();
                            }}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={!canConfirm} onClick={onConfirmNewSave}>
                            Save design
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
