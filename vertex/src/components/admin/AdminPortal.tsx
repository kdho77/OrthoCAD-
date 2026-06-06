import { Coins, KeyRound, ScrollText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AdminPortalProps {
    open: boolean;
    onClose: () => void;
}

// Super Admin Portal scaffold (/admin). Phase 4 wires these to tRPC mutations
// for license/token administration and audit-log queries.
export function AdminPortal({ open, onClose }: AdminPortalProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
            <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-panel shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold">Super Admin Portal</h2>
                    <Button size="icon" variant="ghost" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <Tabs defaultValue="licenses" className="flex flex-1 flex-col overflow-hidden">
                    <div className="border-b border-border px-4 py-2">
                        <TabsList>
                            <TabsTrigger value="licenses">
                                <KeyRound className="mr-1 h-3.5 w-3.5" /> Licenses
                            </TabsTrigger>
                            <TabsTrigger value="tokens">
                                <Coins className="mr-1 h-3.5 w-3.5" /> Tokens
                            </TabsTrigger>
                            <TabsTrigger value="audit">
                                <ScrollText className="mr-1 h-3.5 w-3.5" /> Audit Log
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 text-sm text-muted-foreground">
                        <TabsContent value="licenses">
                            <Placeholder
                                title="License management"
                                items={["Create monthly / yearly / per-seat licenses", "Renew & set expiration", "Revoke licenses", "Per-seat assignment"]}
                            />
                        </TabsContent>
                        <TabsContent value="tokens">
                            <Placeholder
                                title="Export tokens"
                                items={["Add tokens in bulk", "Per-user balances", "Usage history", "Cost schedule (STL: 1, G-code: 2)"]}
                            />
                        </TabsContent>
                        <TabsContent value="audit">
                            <Placeholder
                                title="Audit log"
                                items={["Exports (STL / G-code)", "License changes", "Token grants & deductions", "Sign-in events"]}
                            />
                        </TabsContent>
                    </div>
                </Tabs>
            </div>
        </div>
    );
}

function Placeholder({ title, items }: { title: string; items: string[] }) {
    return (
        <div>
            <h3 className="mb-2 text-foreground">{title}</h3>
            <p className="mb-3 text-xs">Backed by Prisma + tRPC in Phase 4. Schema is already defined in <code className="text-primary">prisma/schema.prisma</code>.</p>
            <ul className="list-inside list-disc space-y-1 text-xs">
                {items.map((i) => (
                    <li key={i}>{i}</li>
                ))}
            </ul>
        </div>
    );
}
