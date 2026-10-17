import { useEffect, useLayoutEffect, useState } from "react";
import { AdminPortal } from "@/components/admin/AdminPortal";
import { CaseSummaryBar } from "@/components/clinical/CaseSummaryBar";
import { ClinicalStepRail } from "@/components/clinical/ClinicalStepRail";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { KernelLoadingBanner } from "@/components/layout/KernelLoadingBanner";
import { RightPanel } from "@/components/layout/RightPanel";
import { StatusBar } from "@/components/layout/StatusBar";
import { type NavItem, TopNav } from "@/components/layout/TopNav";
import { PrescriptionUpload } from "@/components/prescription-upload/PrescriptionUpload";
import { Viewer3D } from "@/components/viewer/Viewer3D";
import { ProductTypeBar } from "@/features/afo/ProductTypeBar";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { ClientsView } from "@/features/clients/ClientsView";
import { exportDesign } from "@/features/exports/export-service";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useViewportMode } from "@/hooks/useViewportMode";
import { designNeedsDefaultStockResolution } from "@/lib/geometry/base-asset";
import { applyViewerWallFlagFromSearch } from "@/lib/geometry/procedural-wall/viewer-wall-flag";
import { stockDebug, stockGlbLog } from "@/lib/geometry/stock-debug";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isApiConfigured } from "@/lib/trpc";
import { useAuthStore } from "@/stores/auth-store";
import { ensureDefaultStockBaseResolved, useDesignStore } from "@/stores/design-store";

export default function App() {
    useAuthBootstrap();
    const [nav, setNav] = useState<NavItem>("Production");
    const [adminOpen, setAdminOpen] = useState(false);
    const [rxOpen, setRxOpen] = useState(false);
    const applyPrescription = useDesignStore((s) => s.applyPrescription);
    const { user, loading: authLoading } = useAuthStore();
    const viewport = useViewportMode();

    useLayoutEffect(() => {
        applyViewerWallFlagFromSearch(window.location.search);
    }, []);

    // Apply SAMPLE_Top (and migrate leftover Default.glb) once auth is ready.
    useEffect(() => {
        const bootstrapDesign = useDesignStore.getState().design;
        const bootstrapBase = bootstrapDesign.paired?.rightBase ?? bootstrapDesign.base;
        stockGlbLog(
            `App stock bootstrap effect — url="${bootstrapBase?.url ?? "(pending)"}" glb_path="${bootstrapBase?.glbPath ?? "(none)"}" needsResolution=${designNeedsDefaultStockResolution(bootstrapDesign)}`,
        );
        stockDebug("App stock bootstrap effect", {
            authLoading,
            hasUser: Boolean(user),
            supabaseConfigured: isSupabaseConfigured(),
            apiConfigured: isApiConfigured(),
            needsResolution: designNeedsDefaultStockResolution(bootstrapDesign),
            stockUrl: bootstrapBase?.url ?? null,
            glbPath: bootstrapBase?.glbPath ?? null,
        });

        if (useDesignStore.getState().design.productType === "afo") {
            stockDebug("App stock bootstrap skipped — AFO product (no SAMPLE_Top)");
            return;
        }
        if (authLoading) {
            stockDebug("App stock bootstrap waiting for auth");
            return;
        }
        if (!isApiConfigured()) {
            stockDebug("App stock bootstrap skipped — API not configured");
            return;
        }
        if (isSupabaseConfigured() && !user) {
            stockDebug("App stock bootstrap waiting for signed-in user");
            return;
        }

        stockGlbLog("App stock bootstrap — calling ensureDefaultStockBaseResolved()");
        ensureDefaultStockBaseResolved();
    }, [authLoading, user]);

    useKeyboardShortcuts({
        onPrescription: () => setRxOpen(true),
        onToggleTransparent: () => {
            const v = useDesignStore.getState().viewer;
            useDesignStore.getState().setViewer({ transparent: !v.transparent });
        },
        onExport: () => {
            const side = useDesignStore.getState().exportSide;
            void exportDesign("stl", side);
        },
    });

    // Auth enforcement: when Supabase is configured, require a signed-in user.
    if (isSupabaseConfigured()) {
        if (authLoading) {
            return (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading…
                </div>
            );
        }
        if (!user) return <LoginScreen />;
    }

    return (
        <ErrorBoundary>
            <div className="flex h-full flex-col">
                <KernelLoadingBanner />
                <TopNav
                    active={nav}
                    onNavigate={setNav}
                    onOpenAdmin={() => setAdminOpen(true)}
                    onOpenPrescription={() => setRxOpen(true)}
                />

                <div className="flex min-h-0 flex-1">
                    {nav === "Production" ? (
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                            <ProductTypeBar />
                            <ClinicalStepRail />
                            <CaseSummaryBar />
                            <div className="relative flex min-h-0 flex-1">
                                <main className="min-w-0 flex-1">
                                    <Viewer3D />
                                </main>
                                {viewport === "phone" ? (
                                    <div className="flex w-64 items-center justify-center border-l border-border bg-panel px-4 text-center text-[12px] text-muted-foreground">
                                        Editing is available on a tablet or computer
                                    </div>
                                ) : viewport === "tablet" ? (
                                    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[48%] overflow-hidden border-t border-border bg-panel shadow-lg">
                                        <RightPanel />
                                    </div>
                                ) : (
                                    <RightPanel />
                                )}
                            </div>
                        </div>
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
