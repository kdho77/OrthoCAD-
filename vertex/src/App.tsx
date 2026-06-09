import { useEffect, useState } from "react";
import { AdminPortal } from "@/components/admin/AdminPortal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { KernelLoadingBanner } from "@/components/layout/KernelLoadingBanner";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightPanel } from "@/components/layout/RightPanel";
import { StatusBar } from "@/components/layout/StatusBar";
import { TopNav, type NavItem } from "@/components/layout/TopNav";
import { PrescriptionUpload } from "@/components/prescription-upload/PrescriptionUpload";
import { Viewer3D } from "@/components/viewer/Viewer3D";
import { ClientsView } from "@/features/clients/ClientsView";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { exportDesign } from "@/features/exports/export-service";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { loadOcctKernel } from "@/lib/chili3d";
import { DEFAULT_STOCK_BASE_ID } from "@/lib/geometry/base-asset";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";

export default function App() {
    useAuthBootstrap();
    const [nav, setNav] = useState<NavItem>("Production");
    const [adminOpen, setAdminOpen] = useState(false);
    const [rxOpen, setRxOpen] = useState(false);
    const applyPrescription = useDesignStore((s) => s.applyPrescription);
    const { user, loading } = useAuthStore();

    useEffect(() => {
        void loadOcctKernel();
    }, []);

    // Upgrade the sync stock placeholder to the server default row on first load.
    useEffect(() => {
        const { design, applyDefaultStockBase } = useDesignStore.getState();
        const stockBase = design.paired?.rightBase ?? design.base;
        if (stockBase?.source === "stock" && stockBase.assetId === DEFAULT_STOCK_BASE_ID) {
            void applyDefaultStockBase().catch(() => {
                /* stockBaseError is set inside applyDefaultStockBase / upgradeStockBaseAsync */
            });
        }
    }, []);

    useKeyboardShortcuts({
        onPrescription: () => setRxOpen(true),
        onToggleTransparent: () => {
            const v = useDesignStore.getState().viewer;
            useDesignStore.getState().setViewer({ transparent: !v.transparent });
        },
        onExport: () => {
            void exportDesign("stl", "left");
        },
    });

    // Auth enforcement: when Supabase is configured, require a signed-in user.
    if (isSupabaseConfigured()) {
        if (loading) {
            return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>;
        }
        if (!user) return <LoginScreen />;
    }

    return (
        <ErrorBoundary>
            <div className="flex h-full flex-col">
                <KernelLoadingBanner />
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
        </ErrorBoundary>
    );
}
