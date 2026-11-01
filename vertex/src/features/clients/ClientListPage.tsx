// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { navigate, useLocationPath } from "@/features/admin/admin-nav";
import { storePhiEnabled } from "@/lib/phi-policy";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { type ClientInput, type ClientRecord, useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import {
    CLIENT_PAGE_SIZE,
    type ClientFilter,
    type ClientListQuery,
    type ClientSortKey,
    type DesignKind,
    designCounts,
    formatClientName,
    formatExact,
    formatRelative,
    isOrgAdmin,
    parseClientListQuery,
    queryClientList,
    serializeClientListQuery,
    shoeChartFromInput,
} from "../../../shared/client-files";
import {
    archiveClientRecord,
    createClientRecord,
    createDesignRecord,
    designStateForKind,
    hardDeleteClientRecord,
    restoreClientRecord,
    saveClientRecord,
} from "./client-actions";
import { DirectoryHeader } from "./DirectoryHeader";
import { NewClientDialog } from "./NewClientDialog";
import { RowMenu } from "./RowMenu";
import { clientFilePath } from "./routes";
import { TypePickerDialog } from "./TypePickerDialog";

const FILTERS: { id: ClientFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "insole", label: "Has Insole" },
    { id: "afo", label: "Has AFO" },
    { id: "archived", label: "Archived" },
];

export function ClientListPage() {
    const { search } = useLocationPath();
    const query = parseClientListQuery(search);
    const clients = useClientStore((s) => s.clients);
    const designs = useClientStore((s) => s.designs);
    const user = useAuthStore((s) => s.user);
    const [text, setText] = useState(query.q);
    const [loading, setLoading] = useState(isApiConfigured());
    const [dialog, setDialog] = useState<"create" | ClientRecord | null>(null);
    const [pickerFor, setPickerFor] = useState<string | null>(null);
    const [storePhi, setStorePhi] = useState(storePhiEnabled);

    useEffect(() => {
        setText(query.q);
    }, [query.q]);

    useEffect(() => {
        if (!isApiConfigured()) return;
        trpc.client.policy
            .query()
            .then((policy) => setStorePhi(policy.storePhi))
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        if (!isApiConfigured()) return;
        let cancelled = false;
        trpc.client.list
            .query()
            .then((items) => {
                if (cancelled) return;
                const local = useClientStore.getState().designs;
                useClientStore.getState().replaceDirectory(
                    items.map((item) => item.client),
                    items.flatMap((item) =>
                        item.designs.map((design) => ({
                            ...design,
                            state:
                                local.find((row) => row.id === design.id)?.state ??
                                createDesignWithStockPlaceholder(),
                        })),
                    ),
                );
            })
            .catch((error) => console.warn("[clients] list failed", error))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const handle = window.setTimeout(() => {
            const current = parseClientListQuery(window.location.search);
            if (text === current.q) return;
            writeQuery({ ...current, q: text, page: 1 });
        }, 200);
        return () => window.clearTimeout(handle);
    }, [text]);

    const items = useMemo(
        () =>
            clients.map((client) => ({
                client,
                designs: designs.filter((design) => design.clientId === client.id),
            })),
        [clients, designs],
    );
    const page = queryClientList(items, query);
    const admin = user
        ? isOrgAdmin({ id: user.id, email: user.email, role: user.role, tenantId: null })
        : false;

    const openCreate = () => setDialog("create");

    const onSubmit = async (input: ClientInput, intent: "file" | "design") => {
        if (dialog && dialog !== "create") {
            await saveClientRecord(dialog.id, input);
            setDialog(null);
            return;
        }
        const id = await createClientRecord(input);
        setDialog(null);
        if (intent === "design") setPickerFor(id);
        else navigate(clientFilePath(id));
    };

    return (
        <div className="flex h-full flex-col" data-testid="client-list">
            <DirectoryHeader active="Clients" />
            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-auto p-4 pb-24 md:pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="text-lg font-semibold">Clients</h1>
                    <button
                        type="button"
                        data-testid="new-client"
                        className="hidden min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground md:inline-flex"
                        onClick={openCreate}
                    >
                        <Plus className="h-4 w-4" /> New client
                    </button>
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <label className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                            aria-label="Search clients"
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            placeholder={
                                storePhi
                                    ? "Search name, reference, ordered by, MRN, or DOB"
                                    : "Search name, reference, or ordered by"
                            }
                            className="min-h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                        />
                    </label>
                    <div className="flex flex-wrap gap-1">
                        {FILTERS.map((filter) => (
                            <button
                                key={filter.id}
                                type="button"
                                className={cn(
                                    "min-h-11 rounded-full px-3 text-xs",
                                    query.filter === filter.id
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-secondary text-muted-foreground",
                                )}
                                onClick={() => writeQuery({ ...query, filter: filter.id, page: 1 })}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>
                </div>
                {loading ? (
                    <SkeletonRows />
                ) : page.total === 0 ? (
                    <Empty
                        query={query.q}
                        onClear={() => {
                            setText("");
                            writeQuery({ ...query, q: "", page: 1 });
                        }}
                    />
                ) : (
                    <>
                        <div className="hidden md:block">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b border-border text-xs text-muted-foreground">
                                        <SortHeader label="Name" sortKey="name" query={query} />
                                        {storePhi ? (
                                            <SortHeader
                                                label="DOB"
                                                sortKey="dob"
                                                query={query}
                                                className="hidden xl:table-cell"
                                            />
                                        ) : null}
                                        <SortHeader label="Reference" sortKey="reference" query={query} />
                                        <SortHeader label="Ordered by" sortKey="orderedBy" query={query} />
                                        <SortHeader label="Designs" sortKey="designs" query={query} />
                                        <SortHeader label="Last modified" sortKey="modified" query={query} />
                                        <th className="w-12" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {page.rows.map((row) => (
                                        <ClientRowView
                                            key={row.client.id}
                                            client={row.client}
                                            designs={row.designs}
                                            admin={admin}
                                            storePhi={storePhi}
                                            onOpen={() => navigate(clientFilePath(row.client.id))}
                                            onEdit={() => setDialog(row.client)}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-col gap-2 md:hidden">
                            {page.rows.map((row) => (
                                <ClientCard
                                    key={row.client.id}
                                    client={row.client}
                                    designs={row.designs}
                                    admin={admin}
                                    storePhi={storePhi}
                                    onOpen={() => navigate(clientFilePath(row.client.id))}
                                    onEdit={() => setDialog(row.client)}
                                />
                            ))}
                        </div>
                        {page.total > CLIENT_PAGE_SIZE ? (
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{page.total} clients</span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        className="min-h-11 rounded-md bg-secondary px-3"
                                        disabled={page.page <= 1}
                                        onClick={() => writeQuery({ ...query, page: page.page - 1 })}
                                    >
                                        Previous
                                    </button>
                                    <button
                                        type="button"
                                        className="min-h-11 rounded-md bg-secondary px-3"
                                        disabled={page.page * page.pageSize >= page.total}
                                        onClick={() => writeQuery({ ...query, page: page.page + 1 })}
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </>
                )}
            </div>
            <button
                type="button"
                data-testid="new-client"
                className="fixed bottom-4 right-4 z-30 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg md:hidden"
                onClick={openCreate}
            >
                <Plus className="h-4 w-4" /> New client
            </button>
            <NewClientDialog
                open={dialog !== null}
                mode={dialog && dialog !== "create" ? "edit" : "create"}
                initial={dialog && dialog !== "create" ? dialog : undefined}
                clients={clients}
                exceptId={dialog && dialog !== "create" ? dialog.id : undefined}
                storePhi={storePhi}
                onClose={() => setDialog(null)}
                onOpenExisting={(id) => {
                    setDialog(null);
                    navigate(clientFilePath(id));
                }}
                onSubmit={(input, intent) => void onSubmit(input, intent)}
            />
            <TypePickerDialog
                open={pickerFor !== null}
                onClose={() => setPickerFor(null)}
                onPick={(kind) => {
                    const clientId = pickerFor;
                    setPickerFor(null);
                    if (!clientId) return;
                    void startDesign(clientId, kind);
                }}
            />
        </div>
    );
}

function writeQuery(query: ClientListQuery) {
    navigate(`/clients${serializeClientListQuery(query)}`);
}

async function startDesign(clientId: string, kind: DesignKind) {
    const client = useClientStore.getState().clients.find((row) => row.id === clientId);
    if (!client) return;
    const chart = shoeChartFromInput(client);
    if (kind === "insole") {
        navigate(`${clientFilePath(clientId)}?start=insole`);
        return;
    }
    const designId = await createDesignRecord(clientId, kind, designStateForKind(kind, chart));
    navigate(`/clients/${clientId}/designs/${designId}`);
}

function Empty({ query, onClear }: { query: string; onClear: () => void }) {
    if (!query.trim()) return <p className="text-sm text-muted-foreground">Add your first client</p>;
    return (
        <div className="text-sm text-muted-foreground">
            <p>No clients match "{query}"</p>
            <button type="button" className="mt-2 min-h-11 text-primary underline" onClick={onClear}>
                Clear search
            </button>
        </div>
    );
}

function SkeletonRows() {
    return (
        <div className="space-y-2" aria-hidden>
            {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="h-11 animate-pulse rounded-md bg-secondary/70" />
            ))}
        </div>
    );
}

function SortHeader({
    label,
    sortKey,
    query,
    className,
}: {
    label: string;
    sortKey: ClientSortKey;
    query: ClientListQuery;
    className?: string;
}) {
    const active = query.sort === sortKey;
    return (
        <th className={className}>
            <button
                type="button"
                className="min-h-11 font-medium"
                onClick={() =>
                    writeQuery({
                        ...query,
                        sort: sortKey,
                        dir: active && query.dir === "desc" ? "asc" : "desc",
                        page: 1,
                    })
                }
            >
                {label}
                {active ? (query.dir === "asc" ? " ↑" : " ↓") : ""}
            </button>
        </th>
    );
}

function chips(designs: { kind: "insole" | "afo"; deletedAt: string | null }[]) {
    const counts = designCounts(
        designs.map((design) => ({
            ...design,
            id: "",
            clientId: "",
            ownerId: "",
            name: "",
            notes: "",
            createdAt: "",
            updatedAt: "",
            archivedAt: null,
            hasExport: false,
        })),
    );
    const parts = [];
    if (counts.insole) parts.push(`Insole ${counts.insole}`);
    if (counts.afo) parts.push(`AFO ${counts.afo}`);
    return { total: counts.total, label: parts.join(" · ") };
}

function ClientRowView({
    client,
    designs,
    admin,
    storePhi,
    onOpen,
    onEdit,
}: {
    client: ClientRecord;
    designs: { kind: "insole" | "afo"; deletedAt: string | null; updatedAt: string; id: string }[];
    admin: boolean;
    storePhi: boolean;
    onOpen: () => void;
    onEdit: () => void;
}) {
    const summary = chips(designs);
    const modified =
        [client.updatedAt, ...designs.filter((design) => !design.deletedAt).map((design) => design.updatedAt)]
            .sort()
            .at(-1) ?? client.updatedAt;
    return (
        <tr className="cursor-pointer border-b border-border/60 hover:bg-secondary/40" onClick={onOpen}>
            <td className="min-h-11 py-2 font-semibold">{formatClientName(client)}</td>
            {storePhi ? <td className="hidden py-2 xl:table-cell">{client.dateOfBirth ?? "—"}</td> : null}
            <td className="py-2">{client.reference ?? "—"}</td>
            <td className="py-2">{client.orderedBy ?? "—"}</td>
            <td className="py-2">
                <div>{summary.total}</div>
                {summary.label ? <div className="text-xs text-muted-foreground">{summary.label}</div> : null}
            </td>
            <td className="py-2" title={formatExact(modified)}>
                {formatRelative(modified)}
            </td>
            <td className="py-1">
                <ClientMenu
                    client={client}
                    designCount={designs.length}
                    admin={admin}
                    onOpen={onOpen}
                    onEdit={onEdit}
                />
            </td>
        </tr>
    );
}

function ClientCard({
    client,
    designs,
    admin,
    storePhi,
    onOpen,
    onEdit,
}: {
    client: ClientRecord;
    designs: { kind: "insole" | "afo"; deletedAt: string | null; updatedAt: string; id: string }[];
    admin: boolean;
    storePhi: boolean;
    onOpen: () => void;
    onEdit: () => void;
}) {
    const summary = chips(designs);
    const modified = client.updatedAt;
    return (
        <div className="rounded-xl border border-border bg-panel p-3" onClick={onOpen}>
            <div className="flex items-start justify-between gap-2">
                <button type="button" className="min-h-11 text-left font-semibold" onClick={onOpen}>
                    {formatClientName(client)}
                </button>
                <ClientMenu
                    client={client}
                    designCount={designs.length}
                    admin={admin}
                    onOpen={onOpen}
                    onEdit={onEdit}
                />
            </div>
            <div className="text-xs text-muted-foreground">
                {client.reference?.trim() ? `Ref ${client.reference}` : "No reference"}
                {client.orderedBy?.trim() ? ` · Ordered by ${client.orderedBy}` : ""}
            </div>
            {storePhi ? (
                <div className="text-xs text-muted-foreground">{client.dateOfBirth ?? "No DOB"}</div>
            ) : null}
            {summary.label ? <div className="mt-1 text-xs">{summary.label}</div> : null}
            <div className="mt-1 text-xs text-muted-foreground" title={formatExact(modified)}>
                {formatRelative(modified)}
            </div>
        </div>
    );
}

function ClientMenu({
    client,
    designCount,
    admin,
    onOpen,
    onEdit,
}: {
    client: ClientRecord;
    designCount: number;
    admin: boolean;
    onOpen: () => void;
    onEdit: () => void;
}) {
    const items = [
        { label: "Open", onSelect: onOpen },
        { label: "Edit details", onSelect: onEdit },
        client.archivedAt
            ? { label: "Restore", onSelect: () => void restoreClientRecord(client.id) }
            : { label: "Archive", onSelect: () => void archiveClientRecord(client.id) },
    ];
    if (admin && designCount === 0) {
        items.push({
            label: "Delete client",
            onSelect: () => {
                if (window.confirm(`Delete ${formatClientName(client)}? This can't be undone.`))
                    void hardDeleteClientRecord(client.id);
            },
        });
    }
    return <RowMenu items={items} />;
}
