import { useEffect, useState } from "react";
import { AdminPortal } from "@/components/admin/AdminPortal";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightPanel } from "@/components/layout/RightPanel";
import { TopNav, type NavItem } from "@/components/layout/TopNav";
import { PrescriptionUpload } from "@/components/prescription-upload/PrescriptionUpload";
import { Viewer3D } from "@/components/viewer/Viewer3D";
import { ClientsView } from "@/features/clients/ClientsView";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { loadOcctKernel } from "@/lib/chili3d";

export default function App() {
    useAuthBootstrap();
    const [nav, setNav] = useState<NavItem>("Production");
    const [adminOpen, setAdminOpen] = useState(false);
    const [rxOpen, setRxOpen] = useState(false);

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
                    <ClientsView />
                ) : (
                    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        Orders management arrives in Phase 4.
                    </div>
                )}
            </div>

            <AdminPortal open={adminOpen} onClose={() => setAdminOpen(false)} />
            {/* Phase 1: parse + preview only. Auto-apply (onApply) lands in Phase 2. */}
            <PrescriptionUpload open={rxOpen} onClose={() => setRxOpen(false)} />
        </div>
    );
}
