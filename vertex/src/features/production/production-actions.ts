// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// UI entry for shop jobs. Falls back to the session store when the API is absent.
// Downloads are built in the browser from stored text. Nothing is written into the repo.

import { isApiConfigured, trpc } from "@/lib/trpc";
import { useClientStore } from "@/stores/client-store";
import { useProductionStore } from "@/stores/production-store";
import { formatClientName } from "../../../shared/client-files";
import type { EnqueueInput } from "../../../shared/production-jobs";

export async function loadProduction(): Promise<void> {
    if (!isApiConfigured()) return;
    try {
        const result = await trpc.production.list.query();
        useProductionStore.getState().replace(result.jobs, result.printers);
    } catch (error) {
        console.warn("[production] list fell back to this session", error);
    }
}

function resolveEnqueueContext(): {
    designId: string;
    designName: string;
    designKind: EnqueueInput["designKind"];
    clientId: string;
    clientLabel: string;
} | null {
    const { activeDesignId, designs, clients } = useClientStore.getState();
    if (!activeDesignId) return null;
    const dr = designs.find((d) => d.id === activeDesignId);
    if (!dr) return null;
    const client = clients.find((c) => c.id === dr.clientId);
    const clientLabel =
        client?.displayName?.trim() ||
        formatClientName({ firstName: client?.firstName ?? "", lastName: client?.lastName ?? "" }).trim() ||
        "Client";
    return {
        designId: dr.id,
        designName: dr.name.trim() || "Design",
        designKind: dr.kind,
        clientId: dr.clientId,
        clientLabel,
    };
}

/** Queue a print job for the active persisted design. Requires API or returns false when there is no active design. */
export async function enqueueCurrentDesignPrintFarm(gcode: string): Promise<boolean> {
    const ctx = resolveEnqueueContext();
    if (!ctx) return false;
    const input: EnqueueInput = {
        ...ctx,
        process: "print",
        gcode,
    };
    await withServer(
        () => trpc.production.enqueue.mutate(input).then(() => undefined),
        () => useProductionStore.getState().enqueuePrint(input),
    );
    return true;
}

async function withServer(run: () => Promise<void>, local: () => Promise<void>): Promise<void> {
    if (isApiConfigured()) {
        try {
            await run();
            await loadProduction();
            return;
        } catch (error) {
            console.warn("[production] action fell back to this session", error);
        }
    }
    await local();
}

export function holdProductionJob(id: string): Promise<void> {
    return withServer(
        () => trpc.production.hold.mutate({ id }),
        () => useProductionStore.getState().hold(id),
    );
}

export function cancelProductionJob(id: string): Promise<void> {
    return withServer(
        () => trpc.production.cancel.mutate({ id }),
        () => useProductionStore.getState().cancel(id),
    );
}

export function retryProductionJob(id: string): Promise<void> {
    return withServer(
        () => trpc.production.retry.mutate({ id }),
        () => useProductionStore.getState().retry(id),
    );
}

export function markProductionJobDone(id: string): Promise<void> {
    return withServer(
        () => trpc.production.markDone.mutate({ id }),
        () => useProductionStore.getState().markDone(id),
    );
}

export function assignProductionJob(id: string, printerId: string): Promise<void> {
    return withServer(
        () => trpc.production.assign.mutate({ id, printerId }),
        () => useProductionStore.getState().assign(id, printerId),
    );
}

export function rerunProductionJob(id: string): Promise<void> {
    return withServer(
        () => trpc.production.rerun.mutate({ id }),
        () => useProductionStore.getState().rerun(id),
    );
}

export function registerMockProductionPrinter(name: string, moonrakerUrl: string): Promise<void> {
    return withServer(
        () => trpc.production.registerMockPrinter.mutate({ name, moonrakerUrl }).then(() => undefined),
        () => useProductionStore.getState().registerMock(name, moonrakerUrl),
    );
}

export async function downloadProductionGcode(id: string): Promise<void> {
    const file = isApiConfigured()
        ? await trpc.production.download.query({ id }).catch(() => useProductionStore.getState().download(id))
        : await useProductionStore.getState().download(id);
    const url = URL.createObjectURL(new Blob([file.gcode], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
}
