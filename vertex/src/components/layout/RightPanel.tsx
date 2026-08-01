import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CorrectionsPanel } from "@/features/corrections/CorrectionsPanel";
import { ElementsPanel } from "@/features/elements/ElementsPanel";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { PrintingPanel } from "@/features/exports/PrintingPanel";

export function RightPanel() {
    return (
        <aside className="flex w-80 flex-col border-l border-border bg-panel">
            <Tabs defaultValue="corrections" className="flex h-full flex-col">
                <div className="border-b border-border p-2">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="corrections">Corrections</TabsTrigger>
                        <TabsTrigger value="design">Elements</TabsTrigger>
                        <TabsTrigger value="printing">Printing</TabsTrigger>
                        <TabsTrigger value="export">Export</TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto p-3">
                    <TabsContent value="corrections">
                        <CorrectionsPanel />
                    </TabsContent>
                    <TabsContent value="design">
                        <ElementsPanel />
                    </TabsContent>
                    <TabsContent value="printing">
                        <PrintingPanel />
                    </TabsContent>
                    <TabsContent value="export">
                        <ExportPanel />
                    </TabsContent>
                </div>
            </Tabs>
        </aside>
    );
}
