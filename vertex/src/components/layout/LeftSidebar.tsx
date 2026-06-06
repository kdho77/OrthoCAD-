import { FileBox, Footprints, Layers3 } from "lucide-react";
import { ScanImport } from "@/features/scans/ScanImport";
import { useDesignStore } from "@/stores/design-store";
import { cn } from "@/lib/utils";
import type { ProductionMethod, ScanPattern } from "@/types";

const PATTERNS: { id: ScanPattern; label: string }[] = [
    { id: "full_contact", label: "Full Contact" },
    { id: "prefab_3d", label: "Prefab 3D" },
    { id: "flat", label: "Flat" },
    { id: "custom", label: "Custom" },
];

const METHODS: { id: ProductionMethod; label: string }[] = [
    { id: "printing_solid", label: "Printing — Solid" },
    { id: "printing_shell", label: "Printing — Shell" },
    { id: "milling_3axis", label: "Milling — 3 Axis" },
];

export function LeftSidebar() {
    const { design, setPattern, setMethod } = useDesignStore();

    return (
        <aside className="flex w-56 flex-col gap-4 overflow-y-auto border-r border-border bg-panel p-3">
            <Section icon={<Footprints className="h-3.5 w-3.5" />} title="Pattern">
                <div className="grid grid-cols-2 gap-1.5">
                    {PATTERNS.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => setPattern(p.id)}
                            className={cn(
                                "rounded-md border px-2 py-2 text-xs transition-colors",
                                design.pattern === p.id
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/50",
                            )}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </Section>

            <Section icon={<Layers3 className="h-3.5 w-3.5" />} title="Production">
                <div className="flex flex-col gap-1.5">
                    {METHODS.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            onClick={() => setMethod(m.id)}
                            className={cn(
                                "rounded-md border px-2 py-2 text-left text-xs transition-colors",
                                design.method === m.id
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/50",
                            )}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            </Section>

            <Section icon={<FileBox className="h-3.5 w-3.5" />} title="Import">
                <ScanImport />
            </Section>
        </aside>
    );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {icon}
                {title}
            </div>
            {children}
        </div>
    );
}
