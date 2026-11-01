// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    type Actor,
    ClientFileError,
    type ClientFileRepo,
    type ClientRow,
    type DesignGeometryWrite,
    type DesignKind,
    type DesignRow,
    type DuplicateCopy,
    shoeChartFromInput,
} from "../../../shared/client-files.js";
import { resolveDevRole } from "./dev-auth.js";

type Row = Record<string, unknown>;

function asKind(value: unknown): DesignKind {
    return value === "afo" ? "afo" : "insole";
}

function asString(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    return String(value);
}

function mapClient(row: Row): ClientRow {
    const dob = asString(row.dateOfBirth);
    return {
        id: String(row.id),
        ownerId: String(row.ownerId),
        tenantId: asString(row.tenantId),
        displayName: asString(row.displayName) ?? "",
        firstName: String(row.firstName ?? ""),
        lastName: String(row.lastName ?? ""),
        dateOfBirth: dob ? dob.slice(0, 10) : null,
        reference: asString(row.reference),
        orderedBy: asString(row.orderedBy),
        mrn: asString(row.mrn),
        email: asString(row.email),
        phone: asString(row.phone),
        notes: asString(row.notes),
        ...shoeChartFromInput({
            shoeSizeUs: typeof row.shoeSizeUs === "number" ? row.shoeSizeUs : undefined,
            shoeSizesSplit: row.shoeSizesSplit === true,
            shoeSizeLeftUs: typeof row.shoeSizeLeftUs === "number" ? row.shoeSizeLeftUs : undefined,
            shoeSizeRightUs: typeof row.shoeSizeRightUs === "number" ? row.shoeSizeRightUs : undefined,
            shoeWidth: asString(row.shoeWidth) as "medium" | undefined,
        }),
        archivedAt: asString(row.archivedAt),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
    };
}

function mapDesign(row: Row, hasExport: boolean): DesignRow {
    return {
        id: String(row.id),
        clientId: String(row.clientId),
        ownerId: String(row.ownerId),
        name: String(row.name ?? ""),
        kind: asKind(row.kind),
        notes: String(row.notes ?? ""),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
        archivedAt: asString(row.archivedAt),
        deletedAt: asString(row.deletedAt),
        hasExport,
    };
}

async function expectRows(
    result: { data: unknown; error: { message: string } | null },
    label: string,
): Promise<Row[]> {
    if (result.error) throw new ClientFileError("BAD_REQUEST", `${label}: ${result.error.message}`);
    return (result.data as Row[] | null) ?? [];
}

export function supabaseClientFileRepo(supabase: SupabaseClient): ClientFileRepo {
    return {
        async listClients() {
            const result = await supabase.from("clients").select("*");
            const rows = await expectRows(result, "List clients");
            return rows.map(mapClient);
        },
        async getClient(id) {
            const { data, error } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
            if (error) throw new ClientFileError("BAD_REQUEST", error.message);
            return data ? mapClient(data as Row) : null;
        },
        async insertClient(row) {
            // Shoe columns are written by the Prisma adapter after the local
            // migration. Omitting them keeps an unmigrated fallback database
            // able to create clients. Scan bytes are never sent here.
            const {
                shoeSizeUs,
                shoeSizesSplit,
                shoeSizeLeftUs,
                shoeSizeRightUs,
                shoeWidth,
                orderedBy,
                ...rest
            } = row;
            void shoeSizeUs;
            void shoeSizesSplit;
            void shoeSizeLeftUs;
            void shoeSizeRightUs;
            void shoeWidth;
            void orderedBy;
            const { error } = await supabase.from("clients").insert(rest);
            if (error) throw new ClientFileError("BAD_REQUEST", error.message);
        },
        async patchClient(id, patch) {
            const {
                shoeSizeUs,
                shoeSizesSplit,
                shoeSizeLeftUs,
                shoeSizeRightUs,
                shoeWidth,
                orderedBy,
                ...rest
            } = patch;
            void shoeSizeUs;
            void shoeSizesSplit;
            void shoeSizeLeftUs;
            void shoeSizeRightUs;
            void shoeWidth;
            void orderedBy;
            const { data, error } = await supabase
                .from("clients")
                .update(rest)
                .eq("id", id)
                .select("*")
                .single();
            if (error || !data)
                throw new ClientFileError("BAD_REQUEST", error?.message ?? "Update client failed");
            return mapClient(data as Row);
        },
        async removeClient(id) {
            const { error } = await supabase.from("clients").delete().eq("id", id);
            if (error) throw new ClientFileError("BAD_REQUEST", error.message);
        },
        async listDesigns() {
            const result = await supabase
                .from("designs")
                .select(
                    "id, clientId, ownerId, name, kind, notes, createdAt, updatedAt, archivedAt, deletedAt",
                );
            const rows = await expectRows(result, "List designs");
            const ids = rows.map((row) => String(row.id));
            const exported = new Set<string>();
            if (ids.length > 0) {
                const exports = await supabase.from("exports").select("designId").in("designId", ids);
                for (const row of (exports.data as Row[] | null) ?? []) {
                    if (row.designId) exported.add(String(row.designId));
                }
            }
            return rows.map((row) => mapDesign(row, exported.has(String(row.id))));
        },
        async getDesign(id) {
            const { data, error } = await supabase
                .from("designs")
                .select(
                    "id, clientId, ownerId, name, kind, notes, createdAt, updatedAt, archivedAt, deletedAt",
                )
                .eq("id", id)
                .maybeSingle();
            if (error) throw new ClientFileError("BAD_REQUEST", error.message);
            if (!data) return null;
            const count = await this.countExports(id);
            return mapDesign(data as Row, count > 0);
        },
        async insertDesign(row) {
            const { error } = await supabase.from("designs").insert({
                id: row.id,
                clientId: row.clientId,
                ownerId: row.ownerId,
                name: row.name,
                kind: row.kind,
                notes: row.notes,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                archivedAt: row.archivedAt,
                deletedAt: row.deletedAt,
            });
            if (error) throw new ClientFileError("BAD_REQUEST", error.message);
        },
        async patchDesign(id, patch) {
            const { hasExport: _hasExport, id: _id, ...columnPatch } = patch;
            const { data, error } = await supabase
                .from("designs")
                .update(columnPatch)
                .eq("id", id)
                .select(
                    "id, clientId, ownerId, name, kind, notes, createdAt, updatedAt, archivedAt, deletedAt",
                )
                .single();
            if (error || !data)
                throw new ClientFileError("BAD_REQUEST", error?.message ?? "Update design failed");
            const hasExport = patch.hasExport ?? (await this.countExports(id)) > 0;
            return mapDesign(data as Row, hasExport);
        },
        async countExports(designId) {
            const { count, error } = await supabase
                .from("exports")
                .select("id", { count: "exact", head: true })
                .eq("designId", designId);
            if (error) return 0;
            return count ?? 0;
        },
        async duplicateDesign(sourceId, copy: DuplicateCopy) {
            const { data: source, error } = await supabase
                .from("designs")
                .select("*")
                .eq("id", sourceId)
                .maybeSingle();
            if (error || !source) throw new ClientFileError("NOT_FOUND", "Design not found");
            const sourceRow = source as Row;
            const insert = {
                ...sourceRow,
                id: copy.id,
                name: copy.name,
                ownerId: copy.ownerId,
                createdAt: copy.now,
                updatedAt: copy.now,
                archivedAt: null,
                deletedAt: null,
            };
            const { error: insertError } = await supabase.from("designs").insert(insert);
            if (insertError) throw new ClientFileError("BAD_REQUEST", insertError.message);
            await copyChildren(supabase, "corrections", sourceId, copy.id);
            await copyChildren(supabase, "elements", sourceId, copy.id);
            return mapDesign(insert, false);
        },
        async loadDesignDocument(id) {
            const { data, error } = await supabase
                .from("designs")
                .select("*, corrections(*), elements(*)")
                .eq("id", id)
                .maybeSingle();
            if (error) throw new ClientFileError("BAD_REQUEST", error.message);
            return data ?? null;
        },
        async saveDesignGeometry(input: DesignGeometryWrite) {
            const { data, error } = await supabase.rpc("vertex_save_design", {
                p_user_id: input.userId,
                p_design_id: input.designId,
                p_name: input.name,
                p_pattern: input.pattern,
                p_method: input.method,
                p_thickness_mm: input.thicknessMm,
                p_unit: input.unit,
                p_linked: input.linked,
                p_corrections: input.corrections,
                p_elements: input.elements,
                p_ip: input.ip,
            });
            if (error) throw new ClientFileError("BAD_REQUEST", `Design save failed: ${error.message}`);
            return (data as { ok: true } | null) ?? { ok: true as const };
        },
        async audit(entry) {
            try {
                await supabase.from("audit_logs").insert({
                    userId: entry.userId,
                    action: entry.action,
                    targetId: entry.targetId,
                    metadata: null,
                });
            } catch {
                // Audit is best-effort; a logging failure must not drop the clinical write.
            }
        },
    };
}

async function copyChildren(
    supabase: SupabaseClient,
    table: "corrections" | "elements",
    sourceId: string,
    designId: string,
) {
    const { data, error } = await supabase.from(table).select("*").eq("designId", sourceId);
    if (error || !data?.length) return;
    const rows = (data as Row[]).map((row) => ({
        ...row,
        id: crypto.randomUUID(),
        designId,
    }));
    await supabase.from(table).insert(rows);
}

export async function actorFor(
    user: { id: string; email: string; role: string },
    supabase: SupabaseClient,
): Promise<Actor> {
    const { data } = await supabase
        .from("users")
        .select("tenantId, role, tenant:tenants(name)")
        .eq("id", user.id)
        .maybeSingle();
    const row = data as {
        tenantId?: string | null;
        role?: string;
        tenant?: { name?: string } | { name?: string }[] | null;
    } | null;
    const tenant = row?.tenant;
    const tenantName = Array.isArray(tenant) ? tenant[0]?.name : tenant?.name;
    return {
        id: user.id,
        email: user.email,
        role: resolveDevRole(user.email, user.role || row?.role),
        tenantId: row?.tenantId ?? null,
        tenantName: tenantName ?? null,
    };
}
