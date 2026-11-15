// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { navigate } from "@/features/admin/admin-nav";
import { defaultAfoDesignState } from "@/lib/geometry/afo/defaults";
import { useAuthStore } from "@/stores/auth-store";
import { isDirectoryUnresolved, useClientStore } from "@/stores/client-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { formatClientName } from "../../../shared/client-files";
import { hydrateDesignForEditor } from "./client-actions";
import { clientFilePath } from "./routes";
import { loadDesignWorkflowSession } from "./design-workflow-session";
import { beginInsoleDesignSession, parseDesignEntryParam } from "./start-path";

export function useDesignRoute(clientId: string, designId: string) {
    const record = useClientStore(
        (s) => s.designs.find((design) => design.id === designId && design.clientId === clientId) ?? null,
    );
    const directoryStatus = useClientStore((s) => s.directoryStatus);
    const authLoading = useAuthStore((s) => s.loading);
    // The directory is empty on a fresh reload until client.list returns. Don't
    // treat that gap as "not in the current session".
    const resolving = authLoading || isDirectoryUnresolved(record !== null, directoryStatus);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!resolving || authLoading) return;
        void useClientStore.getState().loadDirectory();
    }, [resolving, authLoading]);

    useEffect(() => {
        if (resolving) return;
        setReady(false);
        let cancelled = false;
        const open = async () => {
            const persist = useDesignStore.persist;
            if (!persist.hasHydrated()) await persist.rehydrate();
            if (cancelled) return;
            const current = useClientStore
                .getState()
                .designs.find((design) => design.id === designId && design.clientId === clientId);
            useClientStore.getState().setActiveClient(clientId);
            useClientStore.getState().setActiveDesign(designId);
            let state = current?.state ?? createDesignWithStockPlaceholder();
            if (current?.kind === "afo") {
                useDesignStore.setState({
                    design: {
                        ...state,
                        productType: "afo",
                        method: state.method ?? "printing_shell",
                        afo: state.afo ?? defaultAfoDesignState(state.afo?.side ?? "left"),
                    },
                });
                useClinicalWorkflowStore.getState().setProductType("afo");
            } else if (current) {
                if (useClinicalWorkflowStore.getState().productType !== "insole") {
                    useClinicalWorkflowStore.getState().setProductType("insole");
                }
                state = await hydrateDesignForEditor(clientId, designId, state);
                useDesignStore.getState().loadDesign(state);
            }
            const params = new URLSearchParams(window.location.search);
            const entry = parseDesignEntryParam(params.get("entry"));
            if (entry) {
                beginInsoleDesignSession(entry);
                params.delete("entry");
                const rest = params.toString();
                const nextUrl = `${window.location.pathname}${rest ? `?${rest}` : ""}`;
                window.history.replaceState(null, "", nextUrl);
            } else {
                const saved = loadDesignWorkflowSession(designId);
                if (saved) {
                    useClinicalWorkflowStore.setState({
                        ...saved,
                        scanGateStickyReason: null,
                        nextBlockReason: null,
                    });
                } else {
                    useClinicalWorkflowStore.setState({
                        step: "scan",
                        designStartPath: null,
                        completedSteps: [],
                        footSideExplicitlyChosen: false,
                        scanGateStickyReason: null,
                        nextBlockReason: null,
                    });
                }
            }
            setReady(true);
        };
        void open();
        return () => {
            cancelled = true;
        };
    }, [clientId, designId, resolving]);

    return { record, ready, resolving };
}

export function EditorChrome({
    clientId,
    designId,
    onRegisterLeave,
}: {
    clientId: string;
    designId: string;
    onRegisterLeave?: (leave: (href: string) => void) => void;
}) {
    const client = useClientStore((s) => s.clients.find((row) => row.id === clientId) ?? null);
    const record = useClientStore((s) => s.designs.find((design) => design.id === designId) ?? null);
    const [name, setName] = useState(record?.name ?? "");
    const [dirty, setDirty] = useState(false);
    const [savedAt, setSavedAt] = useState<Date | null>(null);
    const [pendingHref, setPendingHref] = useState<string | null>(null);
    const dirtyRef = useRef(false);
    const back = clientFilePath(clientId);

    useEffect(() => {
        setName(record?.name ?? "");
    }, [record?.name]);

    useEffect(() => {
        if (!record) return;
        let baseline = JSON.stringify(useDesignStore.getState().design);
        let timer = 0;
        setSavedAt(new Date());
        const unsub = useDesignStore.subscribe((state) => {
            const next = JSON.stringify(state.design);
            const changed = next !== baseline;
            dirtyRef.current = changed;
            setDirty(changed);
            window.clearTimeout(timer);
            if (!changed) return;
            timer = window.setTimeout(() => {
                void (async () => {
                    const latest = useDesignStore.getState().design;
                    try {
                        await useClientStore.getState().saveDesign(record.id, latest);
                        baseline = JSON.stringify(latest);
                        dirtyRef.current = false;
                        setDirty(false);
                        setSavedAt(new Date());
                    } catch {
                        dirtyRef.current = true;
                        setDirty(true);
                    }
                })();
            }, 800);
        });
        return () => {
            unsub();
            window.clearTimeout(timer);
        };
    }, [record?.id, record?.kind]);

    const leave = useCallback((href: string) => {
        if (dirtyRef.current) setPendingHref(href);
        else navigate(href);
    }, []);

    useEffect(() => {
        onRegisterLeave?.(leave);
    }, [leave, onRegisterLeave]);

    const clientLabel = client ? formatClientName(client) : "Client";
    const savedLabel = savedAt
        ? `Saved · ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Saved";

    return (
        <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
                type="button"
                aria-label="Back to client"
                className="inline-flex min-h-11 min-w-11 items-center justify-center"
                onClick={() => leave(back)}
            >
                <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-1 text-sm">
                <button
                    type="button"
                    data-testid="breadcrumb-client"
                    className="min-h-11 max-w-[40%] shrink truncate font-medium"
                    onClick={() => leave(back)}
                >
                    {clientLabel}
                </button>
                <span className="text-muted-foreground">›</span>
                <input
                    aria-label="Design name"
                    value={name}
                    className="min-h-11 min-w-0 max-w-[9rem] flex-1 bg-transparent text-sm xl:max-w-[220px]"
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => {
                        const next = name.trim();
                        if (next && record) useClientStore.getState().renameDesign(record.id, next);
                    }}
                />
            </div>
            <span data-testid="save-state" className="shrink-0 text-xs text-muted-foreground">
                {dirty ? "Saving…" : savedLabel}
            </span>
            <Dialog open={pendingHref !== null} onOpenChange={(next) => !next && setPendingHref(null)}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Save changes?</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            className="min-h-11"
                            onClick={() => setPendingHref(null)}
                        >
                            Stay
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="min-h-11"
                            onClick={() => {
                                const href = pendingHref;
                                setPendingHref(null);
                                if (href) navigate(href);
                            }}
                        >
                            Discard
                        </Button>
                        <Button
                            type="button"
                            className="min-h-11"
                            onClick={() => {
                                void (async () => {
                                    if (record) {
                                        try {
                                            await useClientStore
                                                .getState()
                                                .saveDesign(record.id, useDesignStore.getState().design);
                                        } catch {
                                            return;
                                        }
                                    }
                                    const href = pendingHref;
                                    setDirty(false);
                                    setPendingHref(null);
                                    if (href) navigate(href);
                                })();
                            }}
                        >
                            Save and leave
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function AfoPlaceholder() {
    return (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
                <h1 className="text-lg font-semibold">AFO editor coming soon</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    This design is saved. The AFO editor is not on this build yet.
                </p>
            </div>
        </div>
    );
}
