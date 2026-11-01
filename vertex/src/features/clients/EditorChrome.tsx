// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatClientName } from "../../../shared/client-files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { navigate } from "@/features/admin/admin-nav";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import { clientFilePath } from "./routes";

export function useDesignRoute(clientId: string, designId: string) {
    const record = useClientStore((s) => s.designs.find((design) => design.id === designId && design.clientId === clientId) ?? null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const open = async () => {
            const persist = useDesignStore.persist;
            if (!persist.hasHydrated()) await persist.rehydrate();
            if (cancelled) return;
            const current = useClientStore.getState().designs.find((design) => design.id === designId && design.clientId === clientId);
            useClientStore.getState().setActiveClient(clientId);
            useClientStore.getState().setActiveDesign(designId);
            if (current && current.kind !== "afo") useDesignStore.getState().loadDesign(current.state);
            setReady(true);
        };
        void open();
        return () => {
            cancelled = true;
        };
    }, [clientId, designId]);

    return { record, ready };
}

export function EditorChrome({ clientId, designId }: { clientId: string; designId: string }) {
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
        if (!record || record.kind === "afo") return;
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
                const latest = useDesignStore.getState().design;
                useClientStore.getState().saveDesign(record.id, latest);
                baseline = JSON.stringify(latest);
                dirtyRef.current = false;
                setDirty(false);
                setSavedAt(new Date());
            }, 800);
        });
        return () => {
            unsub();
            window.clearTimeout(timer);
        };
    }, [record?.id, record?.kind]);

    const leave = (href: string) => {
        if (dirtyRef.current) setPendingHref(href);
        else navigate(href);
    };

    const clientLabel = client ? formatClientName(client) : "Client";
    const savedLabel = savedAt
        ? `Saved · ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Saved";

    return (
        <div className="flex min-w-0 flex-1 items-center gap-2">
            <button type="button" aria-label="Back to client" className="inline-flex min-h-11 min-w-11 items-center justify-center" onClick={() => leave(back)}>
                <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-1 text-sm">
                <button type="button" data-testid="breadcrumb-client" className="min-h-11 max-w-[40%] shrink truncate font-medium" onClick={() => leave(back)}>
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
            <span data-testid="save-state" className="shrink-0 text-xs text-muted-foreground">{dirty ? "Saving…" : savedLabel}</span>
            <Dialog open={pendingHref !== null} onOpenChange={(next) => !next && setPendingHref(null)}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Save changes?</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="secondary" className="min-h-11" onClick={() => setPendingHref(null)}>Stay</Button>
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
                                if (record) useClientStore.getState().saveDesign(record.id, useDesignStore.getState().design);
                                const href = pendingHref;
                                setDirty(false);
                                setPendingHref(null);
                                if (href) navigate(href);
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
                <p className="mt-2 text-sm text-muted-foreground">This design is saved. The AFO editor is not on this build yet.</p>
            </div>
        </div>
    );
}
