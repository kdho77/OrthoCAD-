import { Plus, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ClientRow {
    id: string;
    name: string;
    reference: string;
    designs: number;
}

const SEED: ClientRow[] = [
    { id: "1", name: "Jane Doe", reference: "VX-1042", designs: 3 },
    { id: "2", name: "John Smith", reference: "VX-1043", designs: 1 },
];

// Phase 0 placeholder. Full client/design CRUD via tRPC + Prisma lands in Phase 4.
export function ClientsView() {
    const [clients] = useState<ClientRow[]>(SEED);

    return (
        <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between">
                <h1 className="text-lg font-semibold">Clients</h1>
                <Button size="sm">
                    <Plus className="h-4 w-4" /> New client
                </Button>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                        <tr>
                            <th className="px-4 py-2 font-medium">Name</th>
                            <th className="px-4 py-2 font-medium">Reference</th>
                            <th className="px-4 py-2 font-medium">Designs</th>
                        </tr>
                    </thead>
                    <tbody>
                        {clients.map((c) => (
                            <tr key={c.id} className="border-t border-border hover:bg-secondary/40">
                                <td className="flex items-center gap-2 px-4 py-2.5">
                                    <User className="h-4 w-4 text-muted-foreground" />
                                    {c.name}
                                </td>
                                <td className="px-4 py-2.5 text-muted-foreground">{c.reference}</td>
                                <td className="px-4 py-2.5 tabular-nums">{c.designs}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
