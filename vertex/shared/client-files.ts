// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Client-file rules shared by the API and the browser. No CAD geometry.

export const DESIGN_KINDS = ["insole", "afo"] as const;
export type DesignKind = (typeof DESIGN_KINDS)[number];

export const CLIENT_FILTERS = ["all", "insole", "afo", "archived"] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];

export const CLIENT_SORT_KEYS = ["name", "dob", "reference", "designs", "modified"] as const;
export type ClientSortKey = (typeof CLIENT_SORT_KEYS)[number];

export const DESIGN_SORT_KEYS = ["kind", "name", "created", "modified", "notes"] as const;
export type DesignSortKey = (typeof DESIGN_SORT_KEYS)[number];

export const CLIENT_PAGE_SIZE = 50;
export const DESIGN_NOTES_MAX = 500;
export const CLIENT_NOTES_MAX = 2000;
export const DESIGN_RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const IDLE_LOGOUT_MS = 15 * 60 * 1000;
export const IDLE_WARNING_MS = IDLE_LOGOUT_MS - 60 * 1000;
export const CLINICAL_DOCUMENT_TITLE = "OrthoCAD · Client";

export interface Actor {
    id: string;
    email: string;
    role: string;
    tenantId: string | null;
}

export interface ClientRow {
    id: string;
    ownerId: string;
    tenantId: string | null;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    reference: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DesignRow {
    id: string;
    clientId: string;
    ownerId: string;
    name: string;
    kind: DesignKind;
    notes: string;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    deletedAt: string | null;
    hasExport: boolean;
}

export interface ClientInput {
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
    reference?: string | null;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
}

export interface ClientListItem {
    client: ClientRow;
    designs: DesignRow[];
}

export interface ClientListQuery {
    q: string;
    filter: ClientFilter;
    sort: ClientSortKey;
    dir: "asc" | "desc";
    page: number;
}

export interface ClientListResult {
    rows: ClientListItem[];
    total: number;
    page: number;
    pageSize: number;
}

export class ClientFileError extends Error {
    code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST";

    constructor(code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST", message: string) {
        super(message);
        this.code = code;
        this.name = "ClientFileError";
    }
}

export interface DuplicateCopy {
    id: string;
    name: string;
    ownerId: string;
    now: string;
}

export interface ClientFileRepo {
    listClients(): Promise<ClientRow[]>;
    getClient(id: string): Promise<ClientRow | null>;
    insertClient(row: ClientRow): Promise<void>;
    patchClient(id: string, patch: Partial<ClientRow>): Promise<ClientRow>;
    removeClient(id: string): Promise<void>;
    listDesigns(): Promise<DesignRow[]>;
    getDesign(id: string): Promise<DesignRow | null>;
    insertDesign(row: DesignRow): Promise<void>;
    patchDesign(id: string, patch: Partial<DesignRow>): Promise<DesignRow>;
    countExports(designId: string): Promise<number>;
    duplicateDesign(sourceId: string, copy: DuplicateCopy): Promise<DesignRow>;
    audit(entry: { userId: string; action: string; targetId: string }): Promise<void>;
}

export interface MemoryDb {
    clients: ClientRow[];
    designs: DesignRow[];
    exports: { id: string; designId: string }[];
    audits: { userId: string; action: string; targetId: string }[];
}

export function createMemoryClientFileRepo(db: MemoryDb): ClientFileRepo {
    return {
        async listClients() {
            return db.clients.map((row) => ({ ...row }));
        },
        async getClient(id) {
            const row = db.clients.find((client) => client.id === id);
            return row ? { ...row } : null;
        },
        async insertClient(row) {
            db.clients.push({ ...row });
        },
        async patchClient(id, patch) {
            const index = db.clients.findIndex((client) => client.id === id);
            if (index < 0) throw new ClientFileError("NOT_FOUND", "Client not found");
            const current = db.clients[index];
            if (!current) throw new ClientFileError("NOT_FOUND", "Client not found");
            const next = { ...current, ...patch, id };
            db.clients[index] = next;
            return { ...next };
        },
        async removeClient(id) {
            db.clients = db.clients.filter((client) => client.id !== id);
        },
        async listDesigns() {
            return db.designs.map((row) => ({ ...row }));
        },
        async getDesign(id) {
            const row = db.designs.find((design) => design.id === id);
            return row ? { ...row } : null;
        },
        async insertDesign(row) {
            db.designs.push({ ...row });
        },
        async patchDesign(id, patch) {
            const index = db.designs.findIndex((design) => design.id === id);
            if (index < 0) throw new ClientFileError("NOT_FOUND", "Design not found");
            const current = db.designs[index];
            if (!current) throw new ClientFileError("NOT_FOUND", "Design not found");
            const next = { ...current, ...patch, id };
            db.designs[index] = next;
            return { ...next };
        },
        async countExports(designId) {
            return db.exports.filter((row) => row.designId === designId).length;
        },
        async duplicateDesign(sourceId, copy) {
            const source = db.designs.find((design) => design.id === sourceId);
            if (!source) throw new ClientFileError("NOT_FOUND", "Design not found");
            const row: DesignRow = {
                ...source,
                id: copy.id,
                name: copy.name,
                ownerId: copy.ownerId,
                createdAt: copy.now,
                updatedAt: copy.now,
                archivedAt: null,
                deletedAt: null,
                hasExport: false,
            };
            db.designs.push(row);
            return { ...row };
        },
        async audit(entry) {
            db.audits.push(entry);
        },
    };
}

export function isSuperAdmin(actor: Actor): boolean {
    return actor.role === "super_admin";
}

export function isOrgAdmin(actor: Actor): boolean {
    return actor.role === "admin" || actor.role === "super_admin";
}

/** Super admin is never blocked. Everyone else stays inside their org, or their own legacy rows. */
export function canAccessOrg(actor: Actor, record: { ownerId: string; tenantId: string | null }): boolean {
    if (isSuperAdmin(actor)) return true;
    if (record.tenantId && actor.tenantId && record.tenantId === actor.tenantId) return true;
    if (!record.tenantId && record.ownerId === actor.id) return true;
    return false;
}

export function formatClientName(client: { firstName: string; lastName: string }): string {
    const last = client.lastName.trim();
    const first = client.firstName.trim();
    if (last === "Unassigned" && !first) return "Unassigned";
    if (!first) return last;
    if (!last) return first;
    return `${last}, ${first}`;
}

export function defaultDesignName(kind: DesignKind, date = new Date()): string {
    const label = kind === "afo" ? "AFO" : "Insole";
    const stamp = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${label} · L/R · ${stamp}`;
}

export function formatRelative(iso: string, now = Date.now()): string {
    const diff = now - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return "";
    const min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hours = Math.round(min / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;
    return new Date(iso).toLocaleDateString();
}

export function formatExact(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
}

export function clinicalDocumentTitle(): string {
    return CLINICAL_DOCUMENT_TITLE;
}

export type IdlePhase = "active" | "warning" | "logout";

export function inactivityPhase(
    idleMs: number,
    warnAt = IDLE_WARNING_MS,
    logoutAt = IDLE_LOGOUT_MS,
): IdlePhase {
    if (idleMs >= logoutAt) return "logout";
    if (idleMs >= warnAt) return "warning";
    return "active";
}

export interface NotesDraft {
    saved: string;
    draft: string;
}

export function editNotes(state: NotesDraft, value: string): NotesDraft {
    return { ...state, draft: value.slice(0, DESIGN_NOTES_MAX) };
}

export function revertNotes(state: NotesDraft): NotesDraft {
    return { ...state, draft: state.saved };
}

export function commitNotes(state: NotesDraft): NotesDraft {
    const saved = state.draft.slice(0, DESIGN_NOTES_MAX);
    return { saved, draft: saved };
}

export function normalizePerson(value: string): string {
    return value.trim().toLowerCase();
}

export function findDuplicateClients(
    clients: ClientRow[],
    input: { firstName: string; lastName: string; dateOfBirth?: string | null },
    exceptId?: string,
): ClientRow[] {
    const first = normalizePerson(input.firstName);
    const last = normalizePerson(input.lastName);
    const dob = (input.dateOfBirth ?? "").trim();
    if (!first || !last) return [];
    return clients.filter((client) => {
        if (client.archivedAt) return false;
        if (exceptId && client.id === exceptId) return false;
        return (
            normalizePerson(client.firstName) === first &&
            normalizePerson(client.lastName) === last &&
            (client.dateOfBirth ?? "").trim() === dob
        );
    });
}

export function activeDesigns(designs: DesignRow[]): DesignRow[] {
    return designs.filter((design) => !design.deletedAt);
}

export function designCounts(designs: DesignRow[]): { total: number; insole: number; afo: number } {
    const visible = activeDesigns(designs);
    return {
        total: visible.length,
        insole: visible.filter((design) => design.kind === "insole").length,
        afo: visible.filter((design) => design.kind === "afo").length,
    };
}

export function clientLastModified(item: ClientListItem): string {
    const stamps = [item.client.updatedAt, ...activeDesigns(item.designs).map((design) => design.updatedAt)];
    return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest), item.client.updatedAt);
}

function dobSearchText(dob: string | null): string {
    if (!dob) return "";
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
    if (!match) return dob.toLowerCase();
    const year = match[1] ?? "";
    const month = match[2] ?? "";
    const day = match[3] ?? "";
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    const pretty = Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
          });
    return `${dob} ${month}/${day}/${year} ${pretty}`.toLowerCase();
}

export function clientMatchesQuery(item: ClientListItem, rawQuery: string): boolean {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return true;
    const client = item.client;
    const name = `${client.lastName} ${client.firstName} ${formatClientName(client)}`.toLowerCase();
    const reference = (client.reference ?? "").toLowerCase();
    return (
        name.includes(query) || reference.includes(query) || dobSearchText(client.dateOfBirth).includes(query)
    );
}

export function clientMatchesFilter(item: ClientListItem, filter: ClientFilter): boolean {
    if (filter === "archived") return Boolean(item.client.archivedAt);
    if (item.client.archivedAt) return false;
    const counts = designCounts(item.designs);
    if (filter === "insole") return counts.insole > 0;
    if (filter === "afo") return counts.afo > 0;
    return true;
}

function compareText(a: string, b: string): number {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function sortClientItems(
    items: ClientListItem[],
    sort: ClientSortKey,
    dir: "asc" | "desc",
): ClientListItem[] {
    const factor = dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
        let order = 0;
        if (sort === "name") order = compareText(formatClientName(a.client), formatClientName(b.client));
        else if (sort === "dob") order = compareText(a.client.dateOfBirth ?? "", b.client.dateOfBirth ?? "");
        else if (sort === "reference")
            order = compareText(a.client.reference ?? "", b.client.reference ?? "");
        else if (sort === "designs") order = designCounts(a.designs).total - designCounts(b.designs).total;
        else order = compareText(clientLastModified(a), clientLastModified(b));
        return order * factor;
    });
}

export function defaultClientListQuery(): ClientListQuery {
    return { q: "", filter: "all", sort: "modified", dir: "desc", page: 1 };
}

export function parseClientListQuery(search: string): ClientListQuery {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const filter = params.get("filter");
    const sort = params.get("sort");
    const dir = params.get("dir");
    const page = Number(params.get("page") ?? "1");
    return {
        q: params.get("q") ?? "",
        filter: CLIENT_FILTERS.includes(filter as ClientFilter) ? (filter as ClientFilter) : "all",
        sort: CLIENT_SORT_KEYS.includes(sort as ClientSortKey) ? (sort as ClientSortKey) : "modified",
        dir: dir === "asc" ? "asc" : "desc",
        page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    };
}

export function serializeClientListQuery(query: ClientListQuery): string {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.filter !== "all") params.set("filter", query.filter);
    if (query.sort !== "modified") params.set("sort", query.sort);
    if (query.dir !== "desc") params.set("dir", query.dir);
    if (query.page > 1) params.set("page", String(query.page));
    const text = params.toString();
    return text ? `?${text}` : "";
}

export function queryClientList(items: ClientListItem[], query: ClientListQuery): ClientListResult {
    const filtered = items.filter(
        (item) => clientMatchesFilter(item, query.filter) && clientMatchesQuery(item, query.q),
    );
    const sorted = sortClientItems(filtered, query.sort, query.dir);
    const pageSize = CLIENT_PAGE_SIZE;
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(query.page, pages);
    const start = (page - 1) * pageSize;
    return { rows: sorted.slice(start, start + pageSize), total: sorted.length, page, pageSize };
}

export function sortDesigns<T extends DesignRow>(
    designs: T[],
    sort: DesignSortKey,
    dir: "asc" | "desc",
): T[] {
    const factor = dir === "asc" ? 1 : -1;
    return [...designs].sort((a, b) => {
        let order = 0;
        if (sort === "kind") order = compareText(a.kind, b.kind);
        else if (sort === "name") order = compareText(a.name, b.name);
        else if (sort === "created") order = compareText(a.createdAt, b.createdAt);
        else if (sort === "notes") order = compareText(a.notes, b.notes);
        else order = compareText(a.updatedAt, b.updatedAt);
        return order * factor;
    });
}

export function canHardDeleteClient(
    actor: Actor,
    designCount: number,
): { ok: true } | { ok: false; reason: string } {
    if (!isOrgAdmin(actor)) return { ok: false, reason: "Admin access required" };
    if (designCount > 0) return { ok: false, reason: "Client still has designs" };
    return { ok: true };
}

export function canRestoreDesign(deletedAt: string | null, now = Date.now()): boolean {
    if (!deletedAt) return false;
    const deleted = new Date(deletedAt).getTime();
    if (!Number.isFinite(deleted)) return false;
    return now - deleted <= DESIGN_RESTORE_WINDOW_MS;
}

export function deleteConfirmRequiresPhrase(hasExport: boolean): boolean {
    return hasExport;
}

function stamp(now?: Date): string {
    return (now ?? new Date()).toISOString();
}

function blankToNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return trimmed ? trimmed : null;
}

async function requireClient(repo: ClientFileRepo, actor: Actor, id: string): Promise<ClientRow> {
    const client = await repo.getClient(id);
    if (!client || !canAccessOrg(actor, client)) throw new ClientFileError("NOT_FOUND", "Client not found");
    return client;
}

async function requireDesign(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
): Promise<{ design: DesignRow; client: ClientRow }> {
    const design = await repo.getDesign(id);
    if (!design) throw new ClientFileError("NOT_FOUND", "Design not found");
    const client = await requireClient(repo, actor, design.clientId);
    return { design, client };
}

export async function listClientFiles(repo: ClientFileRepo, actor: Actor): Promise<ClientListItem[]> {
    const [clients, designs] = await Promise.all([repo.listClients(), repo.listDesigns()]);
    return clients
        .filter((client) => canAccessOrg(actor, client))
        .map((client) => ({ client, designs: designs.filter((design) => design.clientId === client.id) }));
}

export async function previewDuplicates(
    repo: ClientFileRepo,
    actor: Actor,
    input: ClientInput,
    exceptId?: string,
): Promise<ClientRow[]> {
    const items = await listClientFiles(repo, actor);
    return findDuplicateClients(
        items.map((item) => item.client),
        input,
        exceptId,
    );
}

export async function createClientFile(
    repo: ClientFileRepo,
    actor: Actor,
    input: ClientInput,
    now?: Date,
): Promise<{ client: ClientRow; duplicates: ClientRow[] }> {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!firstName || !lastName) throw new ClientFileError("BAD_REQUEST", "First and last name are required");
    const duplicates = await previewDuplicates(repo, actor, { ...input, firstName, lastName });
    const createdAt = stamp(now);
    const client: ClientRow = {
        id: crypto.randomUUID(),
        ownerId: actor.id,
        tenantId: actor.tenantId,
        firstName,
        lastName,
        dateOfBirth: blankToNull(input.dateOfBirth),
        reference: blankToNull(input.reference),
        email: blankToNull(input.email),
        phone: blankToNull(input.phone),
        notes: blankToNull(input.notes)?.slice(0, CLIENT_NOTES_MAX) ?? null,
        archivedAt: null,
        createdAt,
        updatedAt: createdAt,
    };
    await repo.insertClient(client);
    await repo.audit({ userId: actor.id, action: "client_created", targetId: client.id });
    return { client, duplicates };
}

export async function updateClientFile(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    patch: Partial<ClientInput>,
    now?: Date,
): Promise<ClientRow> {
    await requireClient(repo, actor, id);
    const next: Partial<ClientRow> = { updatedAt: stamp(now) };
    if (patch.firstName !== undefined) {
        const firstName = patch.firstName.trim();
        if (!firstName) throw new ClientFileError("BAD_REQUEST", "First name is required");
        next.firstName = firstName;
    }
    if (patch.lastName !== undefined) {
        const lastName = patch.lastName.trim();
        if (!lastName) throw new ClientFileError("BAD_REQUEST", "Last name is required");
        next.lastName = lastName;
    }
    if (patch.dateOfBirth !== undefined) next.dateOfBirth = blankToNull(patch.dateOfBirth);
    if (patch.reference !== undefined) next.reference = blankToNull(patch.reference);
    if (patch.email !== undefined) next.email = blankToNull(patch.email);
    if (patch.phone !== undefined) next.phone = blankToNull(patch.phone);
    if (patch.notes !== undefined) next.notes = blankToNull(patch.notes)?.slice(0, CLIENT_NOTES_MAX) ?? null;
    const saved = await repo.patchClient(id, next);
    await repo.audit({ userId: actor.id, action: "client_updated", targetId: id });
    return saved;
}

export async function archiveClientFile(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    now?: Date,
): Promise<ClientRow> {
    await requireClient(repo, actor, id);
    const saved = await repo.patchClient(id, { archivedAt: stamp(now), updatedAt: stamp(now) });
    await repo.audit({ userId: actor.id, action: "client_archived", targetId: id });
    return saved;
}

export async function restoreClientFile(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    now?: Date,
): Promise<ClientRow> {
    await requireClient(repo, actor, id);
    const saved = await repo.patchClient(id, { archivedAt: null, updatedAt: stamp(now) });
    await repo.audit({ userId: actor.id, action: "client_restored", targetId: id });
    return saved;
}

export async function hardDeleteClientFile(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
): Promise<{ ok: true }> {
    await requireClient(repo, actor, id);
    const designs = (await repo.listDesigns()).filter((design) => design.clientId === id);
    const decision = canHardDeleteClient(actor, designs.length);
    if (!decision.ok) {
        throw new ClientFileError(
            decision.reason === "Admin access required" ? "FORBIDDEN" : "BAD_REQUEST",
            decision.reason,
        );
    }
    await repo.removeClient(id);
    await repo.audit({ userId: actor.id, action: "client_deleted", targetId: id });
    return { ok: true };
}

export async function listDesignFiles(
    repo: ClientFileRepo,
    actor: Actor,
    clientId: string,
    options?: { includeDeleted?: boolean },
): Promise<DesignRow[]> {
    await requireClient(repo, actor, clientId);
    const designs = (await repo.listDesigns()).filter((design) => design.clientId === clientId);
    if (options?.includeDeleted && isOrgAdmin(actor)) return designs;
    return designs.filter((design) => !design.deletedAt);
}

export async function getDesignFile(repo: ClientFileRepo, actor: Actor, id: string): Promise<DesignRow> {
    const { design } = await requireDesign(repo, actor, id);
    return design;
}

export async function createDesignFile(
    repo: ClientFileRepo,
    actor: Actor,
    input: { clientId: string; name: string; kind: DesignKind },
    now?: Date,
): Promise<DesignRow> {
    const client = await requireClient(repo, actor, input.clientId);
    if (client.archivedAt) throw new ClientFileError("BAD_REQUEST", "Client is archived");
    const createdAt = stamp(now);
    const design: DesignRow = {
        id: crypto.randomUUID(),
        clientId: input.clientId,
        ownerId: actor.id,
        name: input.name.trim() || defaultDesignName(input.kind, now),
        kind: input.kind,
        notes: "",
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
        deletedAt: null,
        hasExport: false,
    };
    await repo.insertDesign(design);
    await repo.audit({ userId: actor.id, action: "design_created", targetId: design.id });
    return design;
}

export async function updateDesignMeta(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    patch: { name?: string; notes?: string },
    now?: Date,
): Promise<DesignRow> {
    const { design } = await requireDesign(repo, actor, id);
    if (design.deletedAt) throw new ClientFileError("BAD_REQUEST", "Design is deleted");
    const next: Partial<DesignRow> = { updatedAt: stamp(now) };
    if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw new ClientFileError("BAD_REQUEST", "Name is required");
        next.name = name;
    }
    if (patch.notes !== undefined) next.notes = patch.notes.slice(0, DESIGN_NOTES_MAX);
    const saved = await repo.patchDesign(id, next);
    await repo.audit({ userId: actor.id, action: "design_updated", targetId: id });
    return saved;
}

export async function duplicateDesignFile(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    now?: Date,
): Promise<DesignRow> {
    const { design } = await requireDesign(repo, actor, id);
    if (design.deletedAt) throw new ClientFileError("BAD_REQUEST", "Design is deleted");
    const copy = await repo.duplicateDesign(id, {
        id: crypto.randomUUID(),
        name: `Copy of ${design.name}`,
        ownerId: actor.id,
        now: stamp(now),
    });
    await repo.audit({ userId: actor.id, action: "design_duplicated", targetId: copy.id });
    return copy;
}

export async function archiveDesignFile(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    now?: Date,
): Promise<DesignRow> {
    const { design } = await requireDesign(repo, actor, id);
    if (design.deletedAt) throw new ClientFileError("BAD_REQUEST", "Design is deleted");
    const saved = await repo.patchDesign(id, { archivedAt: stamp(now), updatedAt: stamp(now) });
    await repo.audit({ userId: actor.id, action: "design_archived", targetId: id });
    return saved;
}

export async function restoreArchivedDesign(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    now?: Date,
): Promise<DesignRow> {
    const { design } = await requireDesign(repo, actor, id);
    if (design.deletedAt) throw new ClientFileError("BAD_REQUEST", "Design is deleted");
    const saved = await repo.patchDesign(id, { archivedAt: null, updatedAt: stamp(now) });
    await repo.audit({ userId: actor.id, action: "design_restored", targetId: id });
    return saved;
}

export async function softDeleteDesignFile(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    now?: Date,
): Promise<DesignRow> {
    const { design } = await requireDesign(repo, actor, id);
    if (design.deletedAt) return design;
    const exports = Math.max(design.hasExport ? 1 : 0, await repo.countExports(id));
    const saved = await repo.patchDesign(id, {
        deletedAt: stamp(now),
        hasExport: exports > 0,
        updatedAt: design.updatedAt,
    });
    await repo.audit({ userId: actor.id, action: "design_deleted", targetId: id });
    return saved;
}

export async function restoreDeletedDesign(
    repo: ClientFileRepo,
    actor: Actor,
    id: string,
    now?: Date,
): Promise<DesignRow> {
    if (!isOrgAdmin(actor)) throw new ClientFileError("FORBIDDEN", "Admin access required");
    const { design } = await requireDesign(repo, actor, id);
    if (!design.deletedAt) return design;
    if (!canRestoreDesign(design.deletedAt, (now ?? new Date()).getTime())) {
        throw new ClientFileError("BAD_REQUEST", "Restore window has closed");
    }
    const saved = await repo.patchDesign(id, { deletedAt: null, updatedAt: stamp(now) });
    await repo.audit({ userId: actor.id, action: "design_restored", targetId: id });
    return saved;
}

export interface OrphanDesign {
    id: string;
    ownerId: string;
    clientId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface OrphanOwner {
    userId: string;
    tenantId: string | null;
}

export interface OrphanPlan {
    clients: ClientRow[];
    designUpdates: { id: string; clientId: string; createdAt: string; updatedAt: string; kind: "insole" }[];
}

/**
 * Attach designs with a missing client to one Unassigned client per org.
 * Created and modified dates on the designs are copied through unchanged.
 * Designs that already have a client are left alone. Kind is always insole.
 */
export function planOrphanAttachment(args: {
    designs: OrphanDesign[];
    clientIds: string[];
    owners: OrphanOwner[];
    now: string;
    newId?: () => string;
}): OrphanPlan {
    const known = new Set(args.clientIds);
    const orgOf = new Map(args.owners.map((owner) => [owner.userId, owner.tenantId]));
    const buckets = new Map<string, { tenantId: string | null; ownerId: string; clientId: string }>();
    const designUpdates: OrphanPlan["designUpdates"] = [];
    const makeId = args.newId ?? (() => crypto.randomUUID());

    for (const design of args.designs) {
        if (design.clientId && known.has(design.clientId)) continue;
        const tenantId = orgOf.get(design.ownerId) ?? null;
        const key = tenantId ?? `user:${design.ownerId}`;
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { tenantId, ownerId: design.ownerId, clientId: makeId() };
            buckets.set(key, bucket);
        }
        designUpdates.push({
            id: design.id,
            clientId: bucket.clientId,
            createdAt: design.createdAt,
            updatedAt: design.updatedAt,
            kind: "insole",
        });
    }

    const clients: ClientRow[] = [...buckets.values()].map((bucket) => ({
        id: bucket.clientId,
        ownerId: bucket.ownerId,
        tenantId: bucket.tenantId,
        firstName: "",
        lastName: "Unassigned",
        dateOfBirth: null,
        reference: null,
        email: null,
        phone: null,
        notes: "Designs that had no client file were attached here. Their created and modified dates were not changed.",
        archivedAt: null,
        createdAt: args.now,
        updatedAt: args.now,
    }));

    return { clients, designUpdates };
}
