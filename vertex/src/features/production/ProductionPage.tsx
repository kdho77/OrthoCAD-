// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { AlertTriangle, Circle, Pause, Play, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDeleteDialog } from "@/components/clinical/ConfirmDeleteDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { navigate } from "@/features/admin/admin-nav";
import { DirectoryHeader } from "@/features/clients/DirectoryHeader";
import { designPath } from "@/features/clients/routes";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useProductionStore } from "@/stores/production-store";
import { formatRelative } from "../../../shared/client-files";
import {
    type DueFilter,
    defaultHistoryQuery,
    defaultQueueQuery,
    formatDuration,
    type HistoryQuery,
    type JobProcess,
    type PrinterRecord,
    type PrinterState,
    type ProductionJob,
    printerCards,
    printerStateLabel,
    processLabel,
    type QueueQuery,
    queryHistory,
    queryQueue,
    statusLabel,
} from "../../../shared/production-jobs";
import { gcodeRetentionLabel } from "../../../shared/retention";
import {
    assignProductionJob,
    cancelDispatchedProductionJob,
    cancelProductionJob,
    createBridgeEnrollment,
    dispatchProductionJob,
    downloadProductionGcode,
    holdProductionJob,
    loadProduction,
    markProductionJobDone,
    reconcileProductionPrinter,
    refreshProductionReadiness,
    registerMockProductionPrinter,
    rerunProductionJob,
    retryProductionJob,
    saveMoonrakerProductionPrinter,
} from "./production-actions";

export type ProductionTab = "queue" | "printers" | "history";

const TABS: { id: ProductionTab; label: string; href: string }[] = [
    { id: "queue", label: "Queue", href: "/production/queue" },
    { id: "printers", label: "Printers", href: "/production/printers" },
    { id: "history", label: "History", href: "/production/history" },
];

export function ProductionPage({ tab }: { tab: ProductionTab }) {
    const jobs = useProductionStore((state) => state.jobs);
    const printers = useProductionStore((state) => state.printers);

    useEffect(() => {
        void loadProduction().finally(() => {
            if (!import.meta.env.DEV) return;
            if (!new URLSearchParams(window.location.search).has("e2eRetention")) return;
            useProductionStore.getState().seedRetentionDemo();
        });
    }, []);

    return (
        <div className="flex h-full flex-col" data-testid="production-page">
            <DirectoryHeader active="Production" />
            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-auto p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="text-lg font-semibold">Production</h1>
                    <nav className="flex flex-wrap gap-1" aria-label="Production">
                        {TABS.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                aria-current={tab === item.id ? "page" : undefined}
                                className={cn(
                                    "min-h-11 rounded-full px-3 text-sm",
                                    tab === item.id
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-secondary text-muted-foreground",
                                )}
                                onClick={() => navigate(item.href)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </nav>
                </div>
                {tab === "queue" ? <QueueTab jobs={jobs} printers={printers} /> : null}
                {tab === "printers" ? <PrintersTab jobs={jobs} printers={printers} /> : null}
                {tab === "history" ? <HistoryTab jobs={jobs} /> : null}
            </div>
        </div>
    );
}

function QueueTab({ jobs, printers }: { jobs: ProductionJob[]; printers: PrinterRecord[] }) {
    const [query, setQuery] = useState<QueueQuery>(defaultQueueQuery());
    const [assignId, setAssignId] = useState<string | null>(null);
    const [cancelId, setCancelId] = useState<string | null>(null);
    const [notice, setNotice] = useState("");
    const rows = useMemo(() => queryQueue(jobs, query), [jobs, query]);

    const run = (work: () => Promise<void>) => {
        setNotice("");
        void work().catch((error: unknown) => {
            setNotice(error instanceof Error ? error.message : "That action failed");
        });
    };

    return (
        <section className="flex flex-col gap-3" data-testid="production-queue">
            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
                <input
                    aria-label="Search jobs"
                    value={query.q}
                    placeholder="Search job, client, or order number"
                    className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    onChange={(event) => setQuery({ ...query, q: event.target.value })}
                />
                <Select
                    label="Status"
                    value={query.status}
                    onChange={(status) => setQuery({ ...query, status: status as QueueQuery["status"] })}
                    options={["any", "waiting", "assigned", "running", "paused", "held", "failed"]}
                />
                <Select
                    label="Process"
                    value={query.process}
                    onChange={(process) => setQuery({ ...query, process: process as JobProcess | "any" })}
                    options={["any", "print", "mill"]}
                />
                <Select
                    label="Due date"
                    value={query.due}
                    onChange={(due) => setQuery({ ...query, due: due as DueFilter })}
                    options={["any", "overdue", "today", "week", "none"]}
                />
            </div>
            {notice ? <p className="text-sm text-amber-300">{notice}</p> : null}
            {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs in the queue.</p>
            ) : null}
            <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[64rem] text-left text-sm">
                    <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="py-2 pr-3">Job</th>
                            <th className="py-2 pr-3">Client</th>
                            <th className="py-2 pr-3">Source</th>
                            <th className="py-2 pr-3">Process</th>
                            <th className="py-2 pr-3">Status</th>
                            <th className="py-2 pr-3">Assigned printer</th>
                            <th className="py-2 pr-3">
                                <button
                                    type="button"
                                    className="min-h-11 font-medium"
                                    onClick={() =>
                                        setQuery({ ...query, dir: query.dir === "asc" ? "desc" : "asc" })
                                    }
                                >
                                    Due date {query.dir === "asc" ? "↑" : "↓"}
                                </button>
                            </th>
                            <th className="py-2 pr-3">Age</th>
                            <th className="py-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((job) => (
                            <tr key={job.id} className="border-b border-border/60 align-top">
                                <td className="py-2 pr-3">
                                    <JobTitle job={job} />
                                    <GcodeRetention job={job} />
                                </td>
                                <td className="py-2 pr-3">{job.clientLabel}</td>
                                <td className="py-2 pr-3">
                                    <Source job={job} />
                                </td>
                                <td className="py-2 pr-3">{processLabel(job.process)}</td>
                                <td className="py-2 pr-3">
                                    <Status job={job} />
                                    <DispatchFacts job={job} />
                                </td>
                                <td className="py-2 pr-3">
                                    {job.process === "print" ? (job.printerName ?? "—") : "—"}
                                </td>
                                <td className="py-2 pr-3">{job.dueAt ? job.dueAt.slice(0, 10) : "—"}</td>
                                <td className="py-2 pr-3">{formatRelative(job.createdAt)}</td>
                                <td className="py-2">
                                    <JobActions
                                        job={job}
                                        printers={printers}
                                        onAssign={setAssignId}
                                        onCancel={setCancelId}
                                        run={run}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-col gap-2 md:hidden">
                {rows.map((job) => (
                    <article key={job.id} className="rounded-xl border border-border bg-panel p-3 text-sm">
                        <JobTitle job={job} />
                        <GcodeRetention job={job} />
                        <p className="text-muted-foreground">{job.clientLabel}</p>
                        <p>
                            <Source job={job} /> · {processLabel(job.process)} · <Status job={job} />
                            <DispatchFacts job={job} />
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {job.process === "print" ? (job.printerName ?? "No printer") : "Mill"} · Due{" "}
                            {job.dueAt ? job.dueAt.slice(0, 10) : "—"} · {formatRelative(job.createdAt)}
                        </p>
                        <JobActions
                            job={job}
                            printers={printers}
                            onAssign={setAssignId}
                            onCancel={setCancelId}
                            run={run}
                        />
                    </article>
                ))}
            </div>
            <Dialog open={assignId !== null} onOpenChange={(open) => !open && setAssignId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Assign to printer</DialogTitle>
                    </DialogHeader>
                    {printers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No printers yet. This page does not send printer commands.
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {printers.map((printer) => (
                                <li key={printer.id}>
                                    <button
                                        type="button"
                                        className="min-h-11 w-full rounded-md bg-secondary px-3 text-left text-sm"
                                        onClick={() => {
                                            if (!assignId) return;
                                            const id = assignId;
                                            setAssignId(null);
                                            run(() => assignProductionJob(id, printer.id));
                                        }}
                                    >
                                        {printer.name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </DialogContent>
            </Dialog>
            <ConfirmDeleteDialog
                open={cancelId !== null}
                title="Cancel this job?"
                description={
                    jobs.find((job) => job.id === cancelId)?.dispatchState === "none" ||
                    jobs.find((job) => job.id === cancelId)?.dispatchState === "rejected" ||
                    !cancelId
                        ? "It will move to History. The design is kept."
                        : "This job may already have reached a printer. Queue cancel will be refused until that is safe."
                }
                confirmLabel="Cancel job"
                onClose={() => setCancelId(null)}
                onConfirm={() => {
                    if (!cancelId) return;
                    const id = cancelId;
                    run(() => cancelProductionJob(id));
                }}
            />
        </section>
    );
}

function PrintersTab({ jobs, printers }: { jobs: ProductionJob[]; printers: PrinterRecord[] }) {
    const [name, setName] = useState("");
    const [moonrakerUrl, setMoonrakerUrl] = useState("");
    const [configName, setConfigName] = useState("");
    const [endpoint, setEndpoint] = useState("");
    const [bridgeId, setBridgeId] = useState("");
    const [enabled, setEnabled] = useState(true);
    const [cancellation, setCancellation] = useState<"unsupported" | "explicit">("unsupported");
    const [notice, setNotice] = useState("");
    const cards = printerCards(printers, jobs);

    const register = () => {
        setNotice("");
        void registerMockProductionPrinter(name, moonrakerUrl)
            .then(() => {
                setName("");
            })
            .catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : "Registration failed");
            });
    };

    const configure = () => {
        setNotice("");
        void saveMoonrakerProductionPrinter({
            name: configName,
            address: endpoint,
            bridgeId,
            cancellation,
            enabled,
        })
            .then(() => {
                setConfigName("");
                setEndpoint("");
                setBridgeId("");
            })
            .catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : "Configuration failed");
            });
    };

    const runPrinter = (printerId: string, work: (id: string) => Promise<void>) => {
        setNotice("");
        void work(printerId).catch((error: unknown) => {
            setNotice(error instanceof Error ? error.message : "Printer action failed");
        });
    };

    return (
        <section className="flex flex-col gap-3" data-testid="production-printers">
            <p className="text-sm text-muted-foreground">
                Queue state for two or more printers. Mock registration is not a live printer. A configured
                printer stays unverified, and this page does not open a socket.
            </p>
            <div className="rounded-xl border border-border bg-panel p-3">
                <h2 className="text-sm font-medium">Register mock printer</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                    Simulated Moonraker pairing for development. No outbound requests are made.
                </p>
                <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap">
                    <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                        Name
                        <input
                            aria-label="Printer name"
                            value={name}
                            placeholder="Bay 1"
                            className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                            onChange={(event) => setName(event.target.value)}
                        />
                    </label>
                    <label className="min-w-0 flex-[2] text-xs text-muted-foreground">
                        Moonraker URL
                        <input
                            aria-label="Moonraker URL"
                            value={moonrakerUrl}
                            className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                            onChange={(event) => setMoonrakerUrl(event.target.value)}
                        />
                    </label>
                    <button
                        type="button"
                        className="min-h-11 self-end rounded-md bg-primary px-4 text-sm text-primary-foreground"
                        onClick={register}
                    >
                        Register
                    </button>
                </div>
            </div>
            <div className="rounded-xl border border-border bg-panel p-3" data-testid="configure-printer">
                <h2 className="text-sm font-medium">Configure Moonraker printer</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                    Enter this shop&apos;s printer address. Nothing is prefilled, and the cloud does not
                    connect to it. Saving does not start a print.
                </p>
                <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap">
                    <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                        Name
                        <input
                            aria-label="Configured printer name"
                            value={configName}
                            placeholder="Bay 1"
                            className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                            onChange={(event) => setConfigName(event.target.value)}
                        />
                    </label>
                    <label className="min-w-0 flex-[2] text-xs text-muted-foreground">
                        Printer address
                        <input
                            aria-label="Printer address"
                            value={endpoint}
                            autoComplete="off"
                            placeholder="http://printer-host:7125"
                            className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                            onChange={(event) => setEndpoint(event.target.value)}
                        />
                    </label>
                    <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                        Bridge id
                        <input
                            aria-label="Bridge id"
                            value={bridgeId}
                            autoComplete="off"
                            className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                            onChange={(event) => setBridgeId(event.target.value)}
                        />
                    </label>
                    <label className="min-w-0 text-xs text-muted-foreground">
                        Enabled
                        <input
                            aria-label="Printer enabled"
                            type="checkbox"
                            checked={enabled}
                            className="mt-3 block h-5 w-5"
                            onChange={(event) => setEnabled(event.target.checked)}
                        />
                    </label>
                    <label className="min-w-0 text-xs text-muted-foreground">
                        Cancellation
                        <select
                            aria-label="Cancellation"
                            value={cancellation}
                            className="mt-1 block min-h-11 rounded-md border border-input bg-background px-2 text-sm"
                            onChange={(event) =>
                                setCancellation(
                                    event.target.value === "explicit" ? "explicit" : "unsupported",
                                )
                            }
                        >
                            <option value="unsupported">Unsupported</option>
                            <option value="explicit">Explicit only</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        className="min-h-11 self-end rounded-md bg-primary px-4 text-sm text-primary-foreground"
                        onClick={configure}
                    >
                        Save configuration
                    </button>
                </div>
            </div>
            <BridgeEnrollmentCard />
            {notice ? <p className="text-sm text-amber-300">{notice}</p> : null}
            {cards.length === 0 ? <p className="text-sm text-muted-foreground">No printers yet.</p> : null}
            <div className="grid gap-3 md:grid-cols-2">
                {cards.map((card) => (
                    <article
                        key={card.printer.id}
                        className="rounded-xl border border-border bg-panel p-4"
                        data-testid="printer-card"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="font-semibold">{card.printer.name}</h2>
                            <PrinterStateBadge state={card.printer.state} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {card.printer.adapterMode === "mock-only"
                                ? "Mock only. Not a live printer."
                                : card.printer.adapterMode === "configured"
                                  ? "Configured seam. Not shop-verified. No socket is opened from this app."
                                  : "No controller configuration. Not a live printer."}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Endpoint {card.printer.endpointConfigured ? "stored" : "missing"} · credential{" "}
                            {card.printer.credentialRef ?? "missing"} · cancel {card.printer.cancellation}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                            <Action onClick={() => runPrinter(card.printer.id, refreshProductionReadiness)}>
                                Check readiness
                            </Action>
                            <Action onClick={() => runPrinter(card.printer.id, reconcileProductionPrinter)}>
                                Reconcile status
                            </Action>
                        </div>
                        <p className="mt-3 text-sm">Current: {card.current?.designName ?? "None"}</p>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
                            <div className="h-full bg-primary" style={{ width: `${card.progress ?? 0}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {card.progress == null ? "No progress" : `${card.progress}%`}
                        </p>
                        <p className="mt-2 text-sm">Next: {card.next?.designName ?? "None"}</p>
                    </article>
                ))}
            </div>
        </section>
    );
}

function isProductionAdmin(role: string | undefined): boolean {
    return role === "admin" || role === "super_admin";
}

function BridgeEnrollmentCard() {
    const role = useAuthStore((state) => state.user?.role);
    const [bridgeName, setBridgeName] = useState("");
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState("");
    const [copied, setCopied] = useState(false);
    const [enrollment, setEnrollment] = useState<{
        bridgeId: string;
        proof: string;
        expiresAt: string;
    } | null>(null);
    if (!isProductionAdmin(role)) return null;

    const create = () => {
        const name = bridgeName.trim();
        if (!name || pending) return;
        setNotice("");
        setCopied(false);
        setPending(true);
        void createBridgeEnrollment(name)
            .then((result) => {
                setEnrollment({
                    bridgeId: result.bridgeId,
                    proof: result.proof,
                    expiresAt: result.expiresAt,
                });
                setBridgeName("");
            })
            .catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : "Enrollment failed");
            })
            .finally(() => setPending(false));
    };

    const copy = () => {
        if (!enrollment) return;
        const text = `${enrollment.bridgeId}\n${enrollment.proof}`;
        const clipboard = navigator.clipboard;
        if (!clipboard?.writeText) {
            setNotice("Copy is not available in this browser.");
            return;
        }
        void clipboard.writeText(text).then(
            () => setCopied(true),
            () => setNotice("Copy failed."),
        );
    };

    return (
        <div className="rounded-xl border border-border bg-panel p-3" data-testid="create-bridge-enrollment">
            <h2 className="text-sm font-medium">Create bridge enrollment</h2>
            <p className="mt-1 text-xs text-muted-foreground">
                Creates a bridge id and a one-time proof for the shop computer. The proof is shown once and is
                not saved in this browser.
            </p>
            <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap">
                <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                    Bridge name
                    <input
                        aria-label="Bridge name"
                        value={bridgeName}
                        maxLength={80}
                        autoComplete="off"
                        className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                        onChange={(event) => setBridgeName(event.target.value)}
                    />
                </label>
                <button
                    type="button"
                    className="min-h-11 self-end rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
                    disabled={pending || bridgeName.trim().length === 0}
                    onClick={create}
                >
                    Create bridge enrollment
                </button>
            </div>
            {enrollment ? (
                <div className="mt-3 text-sm" data-testid="bridge-enrollment-proof">
                    <p>
                        Bridge id <span className="font-mono">{enrollment.bridgeId}</span>
                    </p>
                    <p className="mt-1 break-all font-mono">{enrollment.proof}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Expires {enrollment.expiresAt}. This proof expires in 10 minutes.
                    </p>
                    <button
                        type="button"
                        className="mt-2 min-h-11 rounded-md bg-secondary px-3 text-xs"
                        data-testid="copy-bridge-proof"
                        onClick={copy}
                    >
                        {copied ? "Copied" : "Copy"}
                    </button>
                </div>
            ) : null}
            {notice ? <p className="mt-2 text-sm text-amber-300">{notice}</p> : null}
        </div>
    );
}

function HistoryTab({ jobs }: { jobs: ProductionJob[] }) {
    const [query, setQuery] = useState<HistoryQuery>(defaultHistoryQuery());
    const [notice, setNotice] = useState("");
    const rows = useMemo(() => queryHistory(jobs, query), [jobs, query]);
    return (
        <section className="flex flex-col gap-3" data-testid="production-history">
            <div className="flex flex-col gap-2 md:flex-row">
                <Select
                    label="Outcome"
                    value={query.outcome}
                    onChange={(outcome) =>
                        setQuery({ ...query, outcome: outcome as HistoryQuery["outcome"] })
                    }
                    options={["any", "done", "failed", "cancelled"]}
                />
                <label className="text-xs text-muted-foreground">
                    From
                    <input
                        aria-label="From date"
                        type="date"
                        value={query.from}
                        className="mt-1 block min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                        onChange={(event) => setQuery({ ...query, from: event.target.value })}
                    />
                </label>
                <label className="text-xs text-muted-foreground">
                    To
                    <input
                        aria-label="To date"
                        type="date"
                        value={query.to}
                        className="mt-1 block min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                        onChange={(event) => setQuery({ ...query, to: event.target.value })}
                    />
                </label>
            </div>
            {notice ? <p className="text-sm text-amber-300">{notice}</p> : null}
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">No completed jobs.</p> : null}
            <div className="overflow-x-auto">
                <table className="w-full min-w-[48rem] text-left text-sm">
                    <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="py-2 pr-3">Job</th>
                            <th className="py-2 pr-3">Client</th>
                            <th className="py-2 pr-3">Date</th>
                            <th className="py-2 pr-3">Printer or Mill</th>
                            <th className="py-2 pr-3">Operator</th>
                            <th className="py-2 pr-3">Duration</th>
                            <th className="py-2 pr-3">Outcome</th>
                            <th className="py-2">Re-run</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((job) => (
                            <tr key={job.id} className="border-b border-border/60">
                                <td className="py-2 pr-3">
                                    <JobTitle job={job} />
                                    <GcodeRetention job={job} />
                                </td>
                                <td className="py-2 pr-3">{job.clientLabel}</td>
                                <td className="py-2 pr-3">
                                    {(job.finishedAt ?? job.updatedAt).slice(0, 10)}
                                </td>
                                <td className="py-2 pr-3">
                                    {job.process === "mill" ? "Mill" : (job.printerName ?? "—")}
                                </td>
                                <td className="py-2 pr-3">{job.operatorName ?? "—"}</td>
                                <td className="py-2 pr-3">{formatDuration(job.durationMs)}</td>
                                <td className="py-2 pr-3">{statusLabel(job.status)}</td>
                                <td className="py-2">
                                    <button
                                        type="button"
                                        className="min-h-11 rounded-md bg-secondary px-3 text-xs"
                                        onClick={() => {
                                            setNotice("");
                                            void rerunProductionJob(job.id).catch((error: unknown) => {
                                                setNotice(
                                                    error instanceof Error ? error.message : "Re-run failed",
                                                );
                                            });
                                        }}
                                    >
                                        Re-run
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function GcodeRetention({ job }: { job: ProductionJob }) {
    const label = gcodeRetentionLabel(job.gcodeStoredAt, job.orderOpen);
    if (!label) return null;
    return (
        <p className="text-xs text-muted-foreground" data-testid="gcode-countdown">
            {label}
        </p>
    );
}

function JobTitle({ job }: { job: ProductionJob }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{job.designName}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] uppercase tracking-wide">
                {job.designKind === "afo" ? "AFO" : "Insole"}
            </span>
        </div>
    );
}

function Source({ job }: { job: ProductionJob }) {
    if (!job.orderNumber) return <span>Internal</span>;
    if (!job.orderUrl) return <span>{job.orderNumber}</span>;
    return (
        <a className="underline" href={job.orderUrl} target="_blank" rel="noreferrer">
            {job.orderNumber}
        </a>
    );
}

function Status({ job }: { job: ProductionJob }) {
    return (
        <span>
            {statusLabel(job.status)}
            {job.status === "failed" && job.failureReason ? (
                <span className="mt-1 block text-xs text-red-300">{job.failureReason}</span>
            ) : null}
        </span>
    );
}

function DispatchFacts({ job }: { job: ProductionJob }) {
    if (!job.dispatchState || job.dispatchState === "none") return null;
    return (
        <span className="mt-1 block text-xs text-muted-foreground">
            Dispatch {job.dispatchState}
            {job.controllerJobId ? ` · controller ${job.controllerJobId}` : ""}
            {job.dispatchError ? ` · ${job.dispatchError}` : ""}
        </span>
    );
}

function JobActions({
    job,
    printers,
    onAssign,
    onCancel,
    run,
}: {
    job: ProductionJob;
    printers: PrinterRecord[];
    onAssign: (id: string) => void;
    onCancel: (id: string) => void;
    run: (work: () => Promise<void>) => void;
}) {
    const printer = printers.find((item) => item.id === job.printerId) ?? null;
    const canDispatch =
        job.process === "print" && job.status === "assigned" && (job.dispatchState ?? "none") === "none";
    return (
        <div className="flex flex-wrap gap-1">
            <Action onClick={() => navigate(designPath(job.clientId, job.designId))}>Open design</Action>
            {job.process === "print" ? (
                <Action onClick={() => onAssign(job.id)}>Assign to printer</Action>
            ) : null}
            {canDispatch ? (
                <Action onClick={() => run(() => dispatchProductionJob(job.id))}>Dispatch</Action>
            ) : null}
            {printer?.cancellation === "explicit" && job.dispatchState === "acknowledged" ? (
                <Action onClick={() => run(() => cancelDispatchedProductionJob(job.id))}>
                    Cancel on printer
                </Action>
            ) : null}
            {job.process === "mill" ? (
                <Action onClick={() => run(() => downloadProductionGcode(job.id))}>Download G-code</Action>
            ) : null}
            {job.process === "mill" ? (
                <Action onClick={() => run(() => markProductionJobDone(job.id))}>Mark done</Action>
            ) : null}
            <Action onClick={() => run(() => holdProductionJob(job.id))}>Hold</Action>
            <Action onClick={() => onCancel(job.id)}>Cancel</Action>
            {job.status === "failed" ? (
                <Action onClick={() => run(() => retryProductionJob(job.id))}>Retry</Action>
            ) : null}
        </div>
    );
}

function Action({ children, onClick }: { children: string; onClick: () => void }) {
    return (
        <button type="button" className="min-h-11 rounded-md bg-secondary px-2 text-xs" onClick={onClick}>
            {children}
        </button>
    );
}

function Select({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
}) {
    return (
        <label className="text-xs text-muted-foreground">
            {label}
            <select
                aria-label={label}
                value={value}
                className="mt-1 block min-h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                onChange={(event) => onChange(event.target.value)}
            >
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option === "any"
                            ? "Any"
                            : option === "week"
                              ? "Next 7 days"
                              : option[0]?.toUpperCase() + option.slice(1)}
                    </option>
                ))}
            </select>
        </label>
    );
}

function PrinterStateBadge({ state }: { state: PrinterState }) {
    const tone = {
        idle: "text-sky-300",
        running: "text-emerald-300",
        paused: "text-amber-300",
        error: "text-red-300",
        offline: "text-slate-400",
    }[state];
    const Icon = { idle: Circle, running: Play, paused: Pause, error: AlertTriangle, offline: WifiOff }[
        state
    ];
    return (
        <span
            className={cn("inline-flex items-center gap-1 text-xs", tone)}
            data-testid="printer-state"
            data-state={state}
        >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {printerStateLabel(state)}
        </span>
    );
}
