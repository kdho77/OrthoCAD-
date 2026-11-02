// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop jobs stay in memory for the session. G-code is not written to localStorage.

import { create } from "zustand";
import { useAuthStore } from "@/stores/auth-store";
import type { Actor } from "../../shared/client-files";
import {
    assignJob,
    cancelJob,
    downloadGcode,
    holdJob,
    markJobDone,
    type PrinterRecord,
    ProductionError,
    type ProductionJob,
    type ProductionRepo,
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
            return useProductionStore.getState().printers;
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
    replace: (jobs, printers) => useProductionStore.setState({ jobs, printers }),
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
