import { useEffect, useState } from "react";
import { AdminPortal } from "@/components/admin/AdminPortal";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightPanel } from "@/components/layout/RightPanel";
import { StatusBar } from "@/components/layout/StatusBar";
import { TopNav, type NavItem } from "@/components/layout/TopNav";
import { PrescriptionUpload } from "@/components/prescription-upload/PrescriptionUpload";
import { Viewer3D } from "@/components/viewer/Viewer3D";
import { ClientsView } from "@/features/clients/ClientsView";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { loadOcctKernel } from "@/lib/chili3d";
import { useDesignStore } from "@/stores/design-store";

export default function App() {
    useAuthBootstrap();
    const [nav, setNav] = useState<NavItem>("Production");
    const [adminOpen, setAdminOpen] = useState(false);
    const [rxOpen, setRxOpen] = useState(false);
    const applyPrescription = useDesignStore((s) => s.applyPrescription);

    useEffect(() => {
        // Attempt to upgrade to the OCCT kernel; silently keeps the procedural
        // kernel if unavailable.
        void loadOcctKernel();
    }, []);

    return (
        <div className="flex h-full flex-col">
            <TopNav active={nav} onNavigate={setNav} onOpenAdmin={() => setAdminOpen(true)} onOpenPrescription={() => setRxOpen(true)} />

            <div className="flex min-h-0 flex-1">
                {nav === "Production" ? (
                    <>
                        <LeftSidebar />
                        <main className="min-w-0 flex-1">
                            <Viewer3D />
                        </main>
                        <RightPanel />
                    </>
                ) : nav === "Clients" ? (
                    <ClientsView onOpenDesign={() => setNav("Production")} />
                ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
                        <span className="text-foreground">Orders</span>
                        <span className="text-xs">Production queue &amp; fulfilment tracking.</span>
                    </div>
                )}
            </div>

            <StatusBar />

            <AdminPortal open={adminOpen} onClose={() => setAdminOpen(false)} />
            <PrescriptionUpload
                open={rxOpen}
                onClose={() => setRxOpen(false)}
                onApply={(result) => {
                    applyPrescription(result);
                    setNav("Production");
                    setRxOpen(false);
                }}
            />
        </div>
    );
}
