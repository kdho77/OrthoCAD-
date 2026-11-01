// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
    type DesignKind,
    type DesignSortKey,
    canRestoreDesign,
    formatClientName,
    formatExact,
    formatRelative,
    isOrgAdmin,
    sortDesigns,
} from "../../../shared/client-files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { navigate } from "@/features/admin/admin-nav";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore, type ClientInput, type DesignRecord } from "@/stores/client-store";
import { archiveClientRecord, createDesignRecord, saveClientRecord, saveDesignNotes } from "./client-actions";
import { DesignNotesField } from "./DesignNotesField";
import { DirectoryHeader } from "./DirectoryHeader";
import { NewClientDialog } from "./NewClientDialog";
import { RowMenu } from "./RowMenu";
import { designPath } from "./routes";
import { TypePickerDialog } from "./TypePickerDialog";
import { cn } from "@/lib/utils";

export function ClientFilePage({ clientId }: { clientId: string }) {
    const clients = useClientStore((s) => s.clients);
    const allDesigns = useClientStore((s) => s.designs);
    const client = clients.find((row) => row.id === clientId) ?? null;
    const designs = useMemo(() => allDesigns.filter((row) => row.clientId === clientId), [allDesigns, clientId]);
    const user = useAuthStore((s) => s.user);
    const [editing, setEditing] = useState(false);
    const [picker, setPicker] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [sort, setSort] = useState<DesignSortKey>("modified");
    const [dir, setDir] = useState<"asc" | "desc">("desc");
    const [toast, setToast] = useState<{ name: string; id: string } | null>(null);
    const [pendingDelete, setPendingDelete] = useState<DesignRecord | null>(null);
    const admin = user ? isOrgAdmin({ id: user.id, email: user.email, role: user.role, tenantId: null }) : false;

    const visible = useMemo(() => {
        const rows = designs.filter((design) => !design.deletedAt && (showArchived ? Boolean(design.archivedAt) : !design.archivedAt));
        return sortDesigns(rows, sort, dir);
    }, [designs, showArchived, sort, dir]);
    const deleted = designs.filter((design) => design.deletedAt);
    const archivedCount = designs.filter((design) => design.archivedAt && !design.deletedAt).length;

    if (!client) {
        return (
            <div className="flex h-full flex-col">
                <DirectoryHeader active="Clients" />
                <div className="p-6 text-sm text-muted-foreground">
                    This client file is not in the current session.{" "}
                    <button type="button" className="min-h-11 text-primary underline" onClick={() => navigate("/clients")}>
                        Back to clients
                    </button>
                </div>
            </div>
        );
    }

    const pick = async (kind: DesignKind) => {
        setPicker(false);
        const designId = await createDesignRecord(client.id, kind);
        navigate(designPath(client.id, designId));
    };

    return (
        <div className="flex h-full flex-col" data-testid="client-file">
            <DirectoryHeader active="Clients" />
            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-auto p-4">
                <div className="text-sm text-muted-foreground">
                    <button type="button" className="min-h-11 hover:text-foreground" onClick={() => navigate("/clients")}>
                        Clients
                    </button>
                    <span> › </span>
                    <span className="text-foreground">{formatClientName(client)}</span>
                </div>
                <section className="rounded-xl border border-border bg-panel p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h1 className="text-lg font-semibold">{formatClientName(client)}</h1>
                            <p className="text-sm text-muted-foreground">{client.dateOfBirth ?? "No date of birth"} · {client.reference ?? "No client ID"}</p>
                            <p className="text-sm text-muted-foreground">{client.phone || "No phone"} · {client.email || "No email"}</p>
                            {client.notes ? <p className="mt-2 text-sm">{client.notes}</p> : null}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" className="min-h-11" onClick={() => setEditing(true)}>Edit</Button>
                            <RowMenu
                                items={[
                                    { label: "Edit details", onSelect: () => setEditing(true) },
                                    client.archivedAt
                                        ? { label: "Restore", onSelect: () => useClientStore.getState().restoreClient(client.id) }
                                        : { label: "Archive", onSelect: () => void archiveClientRecord(client.id) },
                                ]}
                            />
                        </div>
                    </div>
                </section>
                <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold">Designs ({designs.filter((design) => !design.deletedAt && !design.archivedAt).length})</h2>
                        <div className="flex items-center gap-2">
                            {archivedCount > 0 ? (
                                <button type="button" className="min-h-11 text-xs text-muted-foreground underline" onClick={() => setShowArchived((value) => !value)}>
                                    {showArchived ? "Show active" : `Archived (${archivedCount})`}
                                </button>
                            ) : null}
                            <Button type="button" className="min-h-11" onClick={() => setPicker(true)}>
                                <Plus className="h-4 w-4" /> New design
                            </Button>
                        </div>
                    </div>
                    {visible.length === 0 && !showArchived ? (
                        <div>
                            <p className="mb-3 text-sm text-muted-foreground">No designs yet</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <TypeCard label="Insole" detail="Full-length or 3/4 foot orthotic" onClick={() => void pick("insole")} testId="type-insole" />
                                <TypeCard label="AFO" detail="Ankle-foot orthosis" onClick={() => void pick("afo")} testId="type-afo" />
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="hidden text-xs text-muted-foreground md:grid md:grid-cols-[88px_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_44px] md:px-2 xl:grid-cols-[88px_minmax(0,1.2fr)_110px_minmax(0,0.8fr)_minmax(0,1fr)_44px]">
                                <SortButton label="Type" sortKey="kind" sort={sort} dir={dir} onSort={setSort} onDir={setDir} />
                                <SortButton label="Name" sortKey="name" sort={sort} dir={dir} onSort={setSort} onDir={setDir} />
                                <SortButton label="Created" sortKey="created" sort={sort} dir={dir} onSort={setSort} onDir={setDir} className="hidden xl:flex" />
                                <SortButton label="Last modified" sortKey="modified" sort={sort} dir={dir} onSort={setSort} onDir={setDir} />
                                <SortButton label="Notes" sortKey="notes" sort={sort} dir={dir} onSort={setSort} onDir={setDir} />
                                <span />
                            </div>
                            {visible.map((design) => (
                                <DesignRowView
                                    key={design.id}
                                    design={design}
                                    onOpen={() => navigate(designPath(client.id, design.id))}
                                    onDelete={() => setPendingDelete(design)}
                                    onDuplicate={() => {
                                        const id = useClientStore.getState().duplicateDesign(design.id);
                                        if (!id) return;
                                        const copy = useClientStore.getState().designs.find((row) => row.id === id);
                                        setToast({ id, name: copy?.name ?? "Copy" });
                                    }}
                                    onNotes={(notes) => void saveDesignNotes(design.id, notes)}
                                />
                            ))}
                        </div>
                    )}
                    {admin && deleted.length > 0 ? (
                        <div className="mt-6">
                            <h3 className="mb-2 text-sm font-semibold">Recently deleted</h3>
                            {deleted.map((design) => {
                                const open = canRestoreDesign(design.deletedAt);
                                return (
                                    <div key={design.id} className="flex min-h-11 items-center justify-between gap-2 border-b border-border/60 py-2 text-sm">
                                        <span className="truncate">{design.name}</span>
                                        {open ? (
                                            <button type="button" className="min-h-11 text-primary" onClick={() => useClientStore.getState().restoreDesign(design.id)}>
                                                Restore
                                            </button>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">Restore window closed</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                </section>
            </div>
            {toast ? (
                <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-panel px-3 py-2 text-sm shadow-xl">
                    <span>{toast.name}</span>
                    <button type="button" className="min-h-11 text-primary" onClick={() => { navigate(designPath(client.id, toast.id)); setToast(null); }}>
                        Open
                    </button>
                </div>
            ) : null}
            <NewClientDialog
                open={editing}
                mode="edit"
                initial={client}
                clients={clients}
                exceptId={client.id}
                onClose={() => setEditing(false)}
                onOpenExisting={(id) => { setEditing(false); navigate(`/clients/${id}`); }}
                onSubmit={(input) => {
                    void saveClientDetails(client.id, input);
                    setEditing(false);
                }}
            />
            <TypePickerDialog open={picker} onClose={() => setPicker(false)} onPick={(kind) => void pick(kind)} />
            <DeleteDesignDialog
                design={pendingDelete}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => {
                    if (!pendingDelete) return;
                    useClientStore.getState().softDeleteDesign(pendingDelete.id);
                    setPendingDelete(null);
                }}
            />
        </div>
    );
}

function saveClientDetails(id: string, input: ClientInput) {
    return saveClientRecord(id, input);
}

function TypeCard({ label, detail, onClick, testId }: { label: string; detail: string; onClick: () => void; testId: string }) {
    return (
        <button type="button" data-testid={testId} className="min-h-28 rounded-xl border border-border bg-panel p-4 text-left" onClick={onClick}>
            <div className="font-semibold">{label}</div>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </button>
    );
}

function SortButton({
    label,
    sortKey,
    sort,
    dir,
    onSort,
    onDir,
    className,
}: {
    label: string;
    sortKey: DesignSortKey;
    sort: DesignSortKey;
    dir: "asc" | "desc";
    onSort: (key: DesignSortKey) => void;
    onDir: (dir: "asc" | "desc") => void;
    className?: string;
}) {
    const active = sort === sortKey;
    return (
        <button
            type="button"
            className={cn("min-h-11 text-left", className)}
            onClick={() => {
                if (active) onDir(dir === "desc" ? "asc" : "desc");
                else {
                    onSort(sortKey);
                    onDir("desc");
                }
            }}
        >
            {label}
            {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
        </button>
    );
}

function DesignRowView({
    design,
    onOpen,
    onDelete,
    onDuplicate,
    onNotes,
}: {
    design: DesignRecord;
    onOpen: () => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onNotes: (notes: string) => void;
}) {
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(design.name);
    return (
        <div className="rounded-xl border border-border bg-panel p-3 md:grid md:grid-cols-[88px_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_44px] md:items-center md:gap-2 md:border-0 md:bg-transparent md:px-2 xl:grid-cols-[88px_minmax(0,1.2fr)_110px_minmax(0,0.8fr)_minmax(0,1fr)_44px]">
            <button type="button" className="min-h-11 text-left" onClick={onOpen}>
                <span className={cn("rounded-full px-2 py-1 text-xs", design.kind === "afo" ? "bg-violet-400/15 text-violet-200" : "bg-primary/15 text-primary")}>
                    {design.kind === "afo" ? "AFO" : "Insole"}
                </span>
            </button>
            <div className="min-w-0">
                {renaming ? (
                    <Input
                        aria-label="Design name"
                        value={name}
                        autoFocus
                        className="min-h-11"
                        onChange={(event) => setName(event.target.value)}
                        onBlur={() => {
                            const next = name.trim();
                            if (next) useClientStore.getState().renameDesign(design.id, next);
                            setRenaming(false);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                        }}
                    />
                ) : (
                    <button type="button" className="min-h-11 w-full truncate text-left text-sm font-medium" onClick={onOpen}>
                        {design.name}
                    </button>
                )}
            </div>
            <div className="hidden text-xs text-muted-foreground xl:block" title={formatExact(design.createdAt)}>{formatRelative(design.createdAt)}</div>
            <div className="text-xs text-muted-foreground" title={formatExact(design.updatedAt)}>{formatRelative(design.updatedAt)}</div>
            <DesignNotesField value={design.notes} onCommit={onNotes} />
            <RowMenu
                label="Design actions"
                items={[
                    { label: "Open", onSelect: onOpen },
                    { label: "Duplicate", onSelect: onDuplicate },
                    { label: "Rename", onSelect: () => { setName(design.name); setRenaming(true); } },
                    design.archivedAt
                        ? { label: "Restore", onSelect: () => useClientStore.getState().restoreDesignArchive(design.id) }
                        : { label: "Archive", onSelect: () => useClientStore.getState().archiveDesign(design.id) },
                    { label: "Delete", onSelect: onDelete, danger: true },
                ]}
            />
        </div>
    );
}

function DeleteDesignDialog({
    design,
    onClose,
    onConfirm,
}: {
    design: DesignRecord | null;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const [phrase, setPhrase] = useState("");
    const designId = design?.id ?? "";
    const [phraseFor, setPhraseFor] = useState(designId);
    if (phraseFor !== designId) {
        setPhraseFor(designId);
        setPhrase("");
    }
    const needsPhrase = Boolean(design?.hasExport);
    const enabled = !needsPhrase || phrase === "DELETE";
    return (
        <Dialog open={design !== null} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Delete "{design?.name ?? ""}"?</DialogTitle>
                    <p className="text-xs text-muted-foreground">This can't be undone.</p>
                </DialogHeader>
                {needsPhrase ? (
                    <Input aria-label="Type DELETE to confirm" placeholder="Type DELETE" value={phrase} onChange={(event) => setPhrase(event.target.value)} className="min-h-11" />
                ) : null}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>Cancel</Button>
                    <Button type="button" variant="destructive" className="min-h-11" data-testid="delete-confirm" disabled={!enabled} onClick={onConfirm}>
                        Delete
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
