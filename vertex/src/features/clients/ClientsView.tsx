import { FileText, FolderOpen, Plus, Trash2, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import { type ClientInput, useClientStore } from "@/stores/client-store";
import { cn } from "@/lib/utils";

interface ClientsViewProps {
    onOpenDesign: () => void;
}

// Full client / design management (local-first). Master-detail: clients on the
// left, the selected client's designs on the right. Designs load into the live
// design store and open the 3D workspace.
export function ClientsView({ onOpenDesign }: ClientsViewProps) {
    const { clients, designs, activeClientId, setActiveClient, addClient, removeClient, addDesign, removeDesign, setActiveDesign } =
        useClientStore();
    const { loadDesign } = useDesignStore();
    const activeClient = clients.find((c) => c.id === activeClientId) ?? null;
    const clientDesigns = designs.filter((d) => d.clientId === activeClientId);

    const openDesign = (designId: string) => {
        const record = designs.find((d) => d.id === designId);
        if (!record) return;
        loadDesign(record.state);
        setActiveDesign(designId);
        onOpenDesign();
    };

    const newDesign = () => {
        if (!activeClientId) return;
        const id = addDesign(activeClientId, `Design ${clientDesigns.length + 1}`, defaultDesign());
        openDesign(id);
    };

    return (
        <div className="grid flex-1 grid-cols-[320px_1fr] overflow-hidden">
            <div className="flex flex-col overflow-hidden border-r border-border">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold">Clients</h2>
                    <NewClientDialog onCreate={(input) => addClient(input)} />
                </div>
                <div className="flex-1 overflow-y-auto">
                    {clients.length === 0 ? (
                        <p className="p-4 text-xs text-muted-foreground">No clients yet. Create one to begin.</p>
                    ) : (
                        clients.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setActiveClient(c.id)}
                                className={cn(
                                    "flex w-full items-center gap-2 border-b border-border/50 px-4 py-2.5 text-left text-sm hover:bg-secondary/40",
                                    activeClientId === c.id && "bg-secondary/60",
                                )}
                            >
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span className="flex-1 truncate">
                                    {c.firstName} {c.lastName}
                                    {c.reference ? <span className="ml-1 text-xs text-muted-foreground">· {c.reference}</span> : null}
                                </span>
                                <span className="text-xs text-muted-foreground">{designs.filter((d) => d.clientId === c.id).length}</span>
                                <Trash2
                                    className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeClient(c.id);
                                    }}
                                />
                            </button>
                        ))
                    )}
                </div>
            </div>

            <div className="flex flex-col overflow-hidden">
                {activeClient ? (
                    <>
                        <div className="flex items-center justify-between border-b border-border px-4 py-3">
                            <div>
                                <h2 className="text-sm font-semibold">
                                    {activeClient.firstName} {activeClient.lastName}
                                </h2>
                                <p className="text-xs text-muted-foreground">{activeClient.email ?? activeClient.reference ?? "—"}</p>
                            </div>
                            <Button size="sm" onClick={newDesign}>
                                <Plus className="h-4 w-4" /> New design
                            </Button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {clientDesigns.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No designs for this client.</p>
                            ) : (
                                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                                    {clientDesigns.map((d) => (
                                        <div key={d.id} className="rounded-lg border border-border bg-panel p-3">
                                            <div className="mb-2 flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-primary" />
                                                <span className="flex-1 truncate text-sm">{d.name}</span>
                                            </div>
                                            <p className="mb-3 text-[11px] text-muted-foreground">
                                                {d.state.method.replace("_", " ")} · {new Date(d.updatedAt).toLocaleDateString()}
                                            </p>
                                            <div className="flex gap-1">
                                                <Button size="sm" className="h-7 flex-1" onClick={() => openDesign(d.id)}>
                                                    <FolderOpen className="h-3.5 w-3.5" /> Open
                                                </Button>
                                                <Button size="sm" variant="ghost" className="h-7" onClick={() => removeDesign(d.id)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        Select or create a client to manage designs.
                    </div>
                )}
            </div>
        </div>
    );
}

function NewClientDialog({ onCreate }: { onCreate: (input: ClientInput) => void }) {
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState<ClientInput>({ firstName: "", lastName: "" });

    const submit = () => {
        if (!form.firstName.trim() || !form.lastName.trim()) return;
        onCreate(form);
        setForm({ firstName: "", lastName: "" });
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm">
                    <Plus className="h-4 w-4" /> New
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New client</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                        <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                    </div>
                    <Input placeholder="Reference (optional)" value={form.reference ?? ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
                    <Input placeholder="Email (optional)" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    <Button className="w-full" onClick={submit}>
                        Create client
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
