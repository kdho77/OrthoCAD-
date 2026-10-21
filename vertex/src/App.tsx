import { useEffect, useLayoutEffect, useState } from "react";
import { CaseSummaryBar } from "@/components/clinical/CaseSummaryBar";
import { ClinicalStepRail } from "@/components/clinical/ClinicalStepRail";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { KernelLoadingBanner } from "@/components/layout/KernelLoadingBanner";
import { RightPanel } from "@/components/layout/RightPanel";
import { SessionRecoveryDialog } from "@/components/layout/SessionRecoveryDialog";
import { StatusBar } from "@/components/layout/StatusBar";
import { type NavItem, TopNav } from "@/components/layout/TopNav";
import { PrescriptionUpload } from "@/components/prescription-upload/PrescriptionUpload";
import { Viewer3D } from "@/components/viewer/Viewer3D";
import { AdminApp } from "@/features/admin/AdminApp";
import { useLocationPath } from "@/features/admin/admin-nav";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { ClientsView } from "@/features/clients/ClientsView";
import { exportDesign } from "@/features/exports/export-service";
import { MillTableView } from "@/features/mill/MillTableView";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useViewportMode } from "@/hooks/useViewportMode";
import { designNeedsDefaultStockResolution } from "@/lib/geometry/base-asset";
import { applyViewerWallFlagFromSearch } from "@/lib/geometry/procedural-wall/viewer-wall-flag";
import { stockDebug, stockGlbLog } from "@/lib/geometry/stock-debug";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isApiConfigured } from "@/lib/trpc";
import { useAuthStore } from "@/stores/auth-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { ensureDefaultStockBaseResolved, useDesignStore } from "@/stores/design-store";
import { isAdminPath } from "../shared/admin/admin-domain";

export default function App() {
    useAuthBootstrap();
    const { pathname } = useLocationPath();
    const { user, loading: authLoading } = useAuthStore();

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

    if (isAdminPath(pathname)) {
        return (
            <ErrorBoundary>
                <AdminApp />
            </ErrorBoundary>
        );
    }

    return <CadApp />;
}

function CadApp() {
    const [nav, setNav] = useState<NavItem>("Production");
    const [rxOpen, setRxOpen] = useState(false);
    const applyPrescription = useDesignStore((s) => s.applyPrescription);
    const method = useDesignStore((s) => s.design.method);
    const step = useClinicalWorkflowStore((s) => s.step);
    const millLayout = step === "print" && method === "milling_3axis";
    const { user, loading: authLoading } = useAuthStore();
    const viewport = useViewportMode();

    useLayoutEffect(() => {
        applyViewerWallFlagFromSearch(window.location.search);
    }, []);

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

    return (
        <ErrorBoundary>
            <div className="flex h-full flex-col">
                <SessionRecoveryDialog />
                <KernelLoadingBanner />
                <TopNav active={nav} onNavigate={setNav} onOpenPrescription={() => setRxOpen(true)} />

                <div className="flex min-h-0 flex-1">
                    {nav === "Production" ? (
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                            <ClinicalStepRail />
                            <CaseSummaryBar />
                            <div className="relative flex min-h-0 flex-1">
                                <main className="min-w-0 flex-1">
                                    {millLayout ? <MillTableView /> : <Viewer3D />}
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
