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
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { ensureDefaultStockBaseResolved, useDesignStore } from "@/stores/design-store";
import { designNeedsDefaultStockResolution } from "@/lib/geometry/base-asset";
import { isApiConfigured } from "@/lib/trpc";

export default function App() {
    useAuthBootstrap();
    const [nav, setNav] = useState<NavItem>("Production");
    const [adminOpen, setAdminOpen] = useState(false);
    const [rxOpen, setRxOpen] = useState(false);
    const applyPrescription = useDesignStore((s) => s.applyPrescription);
    const { user, loading: authLoading } = useAuthStore();

    useEffect(() => {
        void loadOcctKernel();
    }, []);

    // Resolve the default stock base from the server once auth is ready.
    // Single authoritative bootstrap path for Supabase deployments — avoids the rehydrate/auth race.
    useEffect(() => {
        if (authLoading) return;
        if (!isApiConfigured()) return;
        if (isSupabaseConfigured() && !user) return;

        ensureDefaultStockBaseResolved();

        // If the first attempt raced auth/session hydration, retry once after a short delay.
        const retry = window.setTimeout(() => {
            if (designNeedsDefaultStockResolution(useDesignStore.getState().design)) {
                ensureDefaultStockBaseResolved();
            }
        }, 750);
        return () => window.clearTimeout(retry);
    }, [authLoading, user]);

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
        if (authLoading) {
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
