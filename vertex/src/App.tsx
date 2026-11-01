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
import { navigate, useLocationPath } from "@/features/admin/admin-nav";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { ClientFilePage } from "@/features/clients/ClientFilePage";
import { ClientListPage } from "@/features/clients/ClientListPage";
import { AfoPlaceholder, EditorChrome, useDesignRoute } from "@/features/clients/EditorChrome";
import { InactivityGuard } from "@/features/clients/InactivityGuard";
import { DirectoryHeader } from "@/features/clients/DirectoryHeader";
import { parseClinicalPath } from "@/features/clients/routes";
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
import { clinicalDocumentTitle } from "../shared/client-files";
import { isAdminPath } from "../shared/admin/admin-domain";

export default function App() {
    useAuthBootstrap();
    const { pathname } = useLocationPath();
    const { user, loading: authLoading } = useAuthStore();

    useEffect(() => {
        document.title = clinicalDocumentTitle();
    }, [pathname]);

    if (authLoading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
            </div>
        );
    }
    if (!user) return <LoginScreen />;

    if (isAdminPath(pathname)) {
        return (
            <ErrorBoundary>
                <AdminApp />
            </ErrorBoundary>
        );
    }

    return (
        <>
            <InactivityGuard />
            <ClinicalRoutes pathname={pathname} />
        </>
    );
}

function ClinicalRoutes({ pathname }: { pathname: string }) {
    const route = parseClinicalPath(pathname);

    useLayoutEffect(() => {
        if (route.kind === "home") navigate(`/clients${window.location.search}`);
    }, [route.kind]);

    if (route.kind === "home") return null;
    if (route.kind === "list") return <ClientListPage />;
    if (route.kind === "file") return <ClientFilePage clientId={route.clientId} />;
    if (route.kind === "orders") return <OrdersPage />;
    return <CadApp clientId={route.clientId} designId={route.designId} />;
}

function OrdersPage() {
    return (
        <div className="flex h-full flex-col">
            <DirectoryHeader active="Orders" />
            <div className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
                <span className="text-foreground">Orders</span>
                <span className="text-xs">Production queue &amp; fulfilment tracking.</span>
            </div>
        </div>
    );
}

function CadApp({ clientId, designId }: { clientId: string; designId: string }) {
    const { record } = useDesignRoute(clientId, designId);
    const [rxOpen, setRxOpen] = useState(false);
    const applyPrescription = useDesignStore((s) => s.applyPrescription);
    const method = useDesignStore((s) => s.design.method);
    const step = useClinicalWorkflowStore((s) => s.step);
    const millLayout = step === "print" && method === "milling_3axis";
    const { user, loading: authLoading } = useAuthStore();
    const viewport = useViewportMode();
    const afo = record?.kind === "afo";

    useLayoutEffect(() => {
        applyViewerWallFlagFromSearch(window.location.search);
    }, []);

    useEffect(() => {
        if (afo) return;
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
    }, [authLoading, user, afo]);

    useKeyboardShortcuts({
        onPrescription: () => setRxOpen(true),
        onToggleTransparent: () => {
            const viewer = useDesignStore.getState().viewer;
            useDesignStore.getState().setViewer({ transparent: !viewer.transparent });
        },
        onExport: () => {
            const side = useDesignStore.getState().exportSide;
            void exportDesign("stl", side);
        },
    });

    const go = (item: NavItem) => {
        if (item === "Clients") navigate("/clients");
        else navigate("/orders");
    };

    return (
        <div className="flex h-full flex-col">
            <SessionRecoveryDialog />
            <KernelLoadingBanner />
            <TopNav
                active="Clients"
                onNavigate={go}
                onOpenPrescription={() => setRxOpen(true)}
                leading={<EditorChrome clientId={clientId} designId={designId} />}
            />
            {afo || !record ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    {record ? <AfoPlaceholder /> : (
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                            This design is not in the current session.
                        </div>
                    )}
                </div>
            ) : (
                <ErrorBoundary>
                    <div className="flex min-h-0 flex-1">
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                            <ClinicalStepRail />
                            <CaseSummaryBar />
                            {viewport === "phone" ? (
                                <div className="border-b border-border bg-panel px-4 py-3 text-center text-[12px] text-muted-foreground">
                                    Best on a larger screen
                                </div>
                            ) : null}
                            <div className="relative flex min-h-0 flex-1">
                                <main className="min-w-0 flex-1">
                                    {millLayout ? <MillTableView /> : <Viewer3D />}
                                </main>
                                {viewport === "tablet" ? (
                                    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[48%] overflow-hidden border-t border-border bg-panel shadow-lg">
                                        <RightPanel />
                                    </div>
                                ) : viewport === "desktop" ? (
                                    <RightPanel />
                                ) : null}
                            </div>
                        </div>
                    </div>
                </ErrorBoundary>
            )}
            <StatusBar />
            <PrescriptionUpload
                open={rxOpen}
                onClose={() => setRxOpen(false)}
                onApply={(result) => {
                    applyPrescription(result);
                    setRxOpen(false);
                }}
            />
        </div>
    );
}
