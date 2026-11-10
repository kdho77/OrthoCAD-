// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop jobs stay in memory for the session. G-code is not written to localStorage.

import { create } from "zustand";
import { useAuthStore } from "@/stores/auth-store";
import { type Actor, isSuperAdmin } from "../../shared/client-files";
import { type SaveMoonrakerPrinterInput, saveMoonrakerPrinter } from "../../shared/moonraker-farm";
import type { DispatchDeps, DispatchEvent, PrinterBinding } from "../../shared/production-jobs";
import {
    assignJob,
    cancelDispatchedPrint,
    cancelJob,
    dispatchAssignedJob,
    downloadGcode,
    EMPTY_DISPATCH,
    type EnqueueInput,
    enqueueJob,
    holdJob,
    markJobDone,
    type PrinterRecord,
    ProductionError,
    type ProductionJob,
    type ProductionRepo,
    type RegisterConfiguredPrinterInput,
    reconcilePrinter,
    refreshPrinterReadiness,
    registerConfiguredPrinter,
    registerMockPrinter,
    rerunJob,
    retryJob,
    type StoredGcode,
} from "../../shared/production-jobs";

interface ProductionStore {
    jobs: ProductionJob[];
    printers: PrinterRecord[];
    gcode: Record<string, StoredGcode>;
    replace: (jobs: ProductionJob[], printers: PrinterRecord[]) => void;
    hold: (id: string) => Promise<void>;
    cancel: (id: string) => Promise<void>;
    retry: (id: string) => Promise<void>;
    markDone: (id: string) => Promise<void>;
    assign: (id: string, printerId: string) => Promise<void>;
    rerun: (id: string) => Promise<void>;
    download: (id: string) => Promise<{ filename: string; gcode: string; sha256: string }>;
    registerMock: (name: string, moonrakerUrl: string, shop?: { tenantId: string }) => Promise<void>;
    registerConfigured: (input: RegisterConfiguredPrinterInput) => Promise<void>;
    saveMoonraker: (input: SaveMoonrakerPrinterInput, shop?: { tenantId: string }) => Promise<void>;
    dispatch: (id: string, deps: DispatchDeps) => Promise<void>;
    reconcile: (printerId: string, deps: DispatchDeps) => Promise<void>;
    refreshReadiness: (printerId: string, deps: DispatchDeps) => Promise<void>;
    cancelDispatched: (id: string, deps: DispatchDeps) => Promise<void>;
    enqueuePrint: (input: EnqueueInput) => Promise<void>;
    /** Dev-only preview of the G-code countdown. Not used in production builds. */
    seedRetentionDemo: () => void;
}

function actor(): Actor {
    const user = useAuthStore.getState().user;
    return {
        id: user?.id ?? "local",
        email: user?.email ?? "",
        role: user?.role ?? "clinician",
        tenantId: null,
    };
}

/** Session fallback. A super_admin must name a shop; other roles cannot switch shops. */
function actorForShop(shop?: { tenantId?: string }): Actor {
    const base = actor();
    const chosen = shop?.tenantId?.trim() || "";
    if (isSuperAdmin(base)) {
        if (!chosen) throw new ProductionError("BAD_REQUEST", "A tenant is required.");
        return { ...base, tenantId: chosen };
    }
    if (chosen) throw new ProductionError("FORBIDDEN", "You cannot choose another shop.");
    return base;
}

const endpointByPrinter = new Map<string, string>();
const dispatchEvents: DispatchEvent[] = [];

function repo(): ProductionRepo {
    return {
        async listJobs() {
            return useProductionStore.getState().jobs;
        },
        async getJob(id) {
            return useProductionStore.getState().jobs.find((job) => job.id === id) ?? null;
        },
        async insertJob(job) {
            useProductionStore.setState((state) => ({
                jobs: [job, ...state.jobs.filter((row) => row.id !== job.id)],
            }));
        },
        async patchJob(id, patch) {
            let next: ProductionJob | null = null;
            useProductionStore.setState((state) => ({
                jobs: state.jobs.map((job) => {
                    if (job.id !== id) return job;
                    next = { ...job, ...patch };
                    return next;
                }),
            }));
            if (!next) throw new ProductionError("NOT_FOUND", "Job not found");
            return next;
        },
        async listPrinters() {
            return useProductionStore.getState().printers.map((printer) => ({
                ...printer,
                endpointConfigured: printer.endpointConfigured || endpointByPrinter.has(printer.id),
                liveVerified: false as const,
                protocolVerified: false as const,
            }));
        },
        async insertPrinter(printer) {
            useProductionStore.setState((state) => ({
                printers: [
                    ...state.printers.filter((row) => row.id !== printer.id),
                    { ...printer, liveVerified: false as const, protocolVerified: false as const },
                ],
            }));
        },
        async getPrinterEndpoint(printerId) {
            return endpointByPrinter.get(printerId) ?? null;
        },
        async insertConfiguredPrinter(printer, binding: PrinterBinding) {
            endpointByPrinter.set(printer.id, binding.endpoint);
            useProductionStore.setState((state) => ({
                printers: [
                    ...state.printers.filter((row) => row.id !== printer.id),
                    {
                        ...printer,
                        endpointConfigured: true,
                        liveVerified: false as const,
                        protocolVerified: false as const,
                    },
                ],
            }));
        },
        async patchPrinter(id, patch) {
            let next: PrinterRecord | null = null;
            useProductionStore.setState((state) => ({
                printers: state.printers.map((printer) => {
                    if (printer.id !== id) return printer;
                    next = {
                        ...printer,
                        ...patch,
                        liveVerified: false,
                        protocolVerified: false,
                    };
                    return next;
                }),
            }));
            if (!next) throw new ProductionError("NOT_FOUND", "Printer not found");
            return next;
        },
        async claimDispatch(jobId, fields) {
            let claimed: ProductionJob | null = null;
            useProductionStore.setState((state) => ({
                jobs: state.jobs.map((job) => {
                    if (job.id !== jobId || (job.dispatchState ?? "none") !== "none") return job;
                    claimed = {
                        ...job,
                        ...EMPTY_DISPATCH,
                        ...fields,
                        dispatchState: "started",
                        controllerJobId: null,
                        dispatchError: null,
                    };
                    return claimed;
                }),
            }));
            return claimed;
        },
        async appendDispatchEvent(event) {
            dispatchEvents.push(event);
        },
        async listDispatchEvents(jobId) {
            return dispatchEvents.filter((event) => event.jobId === jobId);
        },
        async getGcode(jobId) {
            return useProductionStore.getState().gcode[jobId] ?? null;
        },
        async putGcode(jobId, value) {
            useProductionStore.setState((state) => ({ gcode: { ...state.gcode, [jobId]: value } }));
        },
        async clearGcode(jobId) {
            useProductionStore.setState((state) => {
                const gcode = { ...state.gcode };
                delete gcode[jobId];
                return { gcode };
            });
        },
    };
}

function remember(job: ProductionJob) {
    useProductionStore.setState((state) => ({
        jobs: [job, ...state.jobs.filter((row) => row.id !== job.id)],
    }));
}

export const useProductionStore = create<ProductionStore>((_set, _get) => ({
    jobs: [],
    printers: [],
    gcode: {},
    replace: (jobs, printers) => {
        endpointByPrinter.clear();
        useProductionStore.setState({ jobs, printers });
    },
    async hold(id) {
        remember(await holdJob(repo(), actor(), id));
    },
    async cancel(id) {
        remember(await cancelJob(repo(), actor(), id));
    },
    async retry(id) {
        remember(await retryJob(repo(), actor(), id));
    },
    async markDone(id) {
        remember(await markJobDone(repo(), actor(), id));
    },
    async assign(id, printerId) {
        remember(await assignJob(repo(), actor(), id, printerId));
    },
    async rerun(id) {
        remember(await rerunJob(repo(), actor(), id));
    },
    download(id) {
        return downloadGcode(repo(), actor(), id);
    },
    async registerMock(name, moonrakerUrl, shop) {
        const result = await registerMockPrinter(repo(), actorForShop(shop), { name, moonrakerUrl });
        useProductionStore.setState((state) => ({
            printers: [...state.printers.filter((row) => row.id !== result.printer.id), result.printer],
        }));
    },
    async registerConfigured(input) {
        const printer = await registerConfiguredPrinter(repo(), actor(), input);
        useProductionStore.setState((state) => ({
            printers: [...state.printers.filter((row) => row.id !== printer.id), printer],
        }));
    },
    async saveMoonraker(input, shop) {
        const printer = await saveMoonrakerPrinter(repo(), actorForShop(shop), input);
        useProductionStore.setState((state) => ({
            printers: [...state.printers.filter((row) => row.id !== printer.id), printer],
        }));
    },
    async dispatch(id, deps) {
        remember(await dispatchAssignedJob(repo(), actor(), id, deps));
    },
    async reconcile(printerId, deps) {
        const jobs = await reconcilePrinter(repo(), actor(), printerId, deps);
        useProductionStore.setState((state) => ({
            jobs: [...jobs, ...state.jobs.filter((job) => !jobs.some((row) => row.id === job.id))],
        }));
    },
    async refreshReadiness(printerId, deps) {
        const printer = await refreshPrinterReadiness(repo(), actor(), printerId, deps);
        useProductionStore.setState((state) => ({
            printers: state.printers.map((row) => (row.id === printer.id ? printer : row)),
        }));
    },
    async cancelDispatched(id, deps) {
        remember(await cancelDispatchedPrint(repo(), actor(), id, deps));
    },
    async enqueuePrint(input) {
        remember(await enqueueJob(repo(), actor(), input));
    },
    seedRetentionDemo() {
        const current = useProductionStore.getState();
        if (current.jobs.some((job) => job.id === "e2e-retention-queue")) return;
        const storedAt = new Date(Date.now() - 67 * 24 * 60 * 60 * 1000).toISOString();
        const base: ProductionJob = {
            id: "e2e-retention-queue",
            designId: "00000000-0000-4000-8000-000000000010",
            designName: "Insole",
            designKind: "insole",
            clientId: "00000000-0000-4000-8000-000000000011",
            clientLabel: "Demo",
            ownerId: actor().id,
            tenantId: null,
            process: "mill",
            status: "waiting",
            orderNumber: null,
            orderUrl: null,
            orderOpen: false,
            printerId: null,
            printerName: null,
            dueAt: null,
            createdAt: storedAt,
            updatedAt: storedAt,
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            operatorName: null,
            failureReason: null,
            progress: null,
            gcodeSha256: "e2e",
            gcodeStoredAt: storedAt,
            ...EMPTY_DISPATCH,
        };
        useProductionStore.setState({
            jobs: [
                base,
                {
                    ...base,
                    id: "e2e-retention-history",
                    status: "done",
                    startedAt: storedAt,
                    finishedAt: storedAt,
                    durationMs: 1000,
                    operatorName: "demo",
                },
                ...current.jobs,
            ],
        });
    },
}));
