// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Prisma adapter and the one-time charge for an existing CAD-operator production.

import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    CadChargeResult,
    CadFootSide,
    CadProductionPatch,
    CadProductionRow,
    CadProductionStatus,
    CadProductionStore,
} from "./cad-operator-production.js";
import { UniqueIdempotencyError } from "./cad-operator-production.js";

type ProductionRecord = {
    id: string;
    designId: string;
    side: CadFootSide | null;
    presetId: string;
    status: CadProductionStatus;
    idempotencyKey: string | null;
    settingsFingerprint: string | null;
    gcodeStorageKey: string | null;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
    leaseExpiresAt: Date | null;
    chargedAt: Date | null;
    exportId: string | null;
    method: "printing_solid" | "printing_shell" | "milling_3axis";
    beltAngleDeg: number | null;
    layerHeightMm: number | null;
    material: string | null;
};

function mapRow(row: ProductionRecord): CadProductionRow {
    if (!row.idempotencyKey || !row.settingsFingerprint) {
        return {
            id: row.id,
            designId: row.designId,
            side: row.side,
            presetId: row.presetId,
            status: row.status,
            idempotencyKey: row.idempotencyKey ?? "",
            settingsFingerprint: row.settingsFingerprint ?? "",
            gcodeStorageKey: row.gcodeStorageKey,
            error: row.error,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            leaseExpiresAt: row.leaseExpiresAt,
            chargedAt: row.chargedAt,
            exportId: row.exportId,
            method: "printing_solid",
            beltAngleDeg: row.beltAngleDeg ?? 45,
            layerHeightMm: row.layerHeightMm,
            material: row.material ?? "",
        };
    }
    return {
        id: row.id,
        designId: row.designId,
        side: row.side,
        presetId: row.presetId,
        status: row.status,
        idempotencyKey: row.idempotencyKey,
        settingsFingerprint: row.settingsFingerprint,
        gcodeStorageKey: row.gcodeStorageKey,
        error: row.error,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        leaseExpiresAt: row.leaseExpiresAt,
        chargedAt: row.chargedAt,
        exportId: row.exportId,
        method: "printing_solid",
        beltAngleDeg: row.beltAngleDeg ?? 45,
        layerHeightMm: row.layerHeightMm,
        material: row.material ?? "",
    };
}

function isUnique(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class PrismaCadProductionStore implements CadProductionStore {
    constructor(private readonly prisma: PrismaClient) {}

    async insert(row: CadProductionRow): Promise<CadProductionRow> {
        try {
            const created = await this.prisma.production.create({
                data: {
                    id: row.id,
                    designId: row.designId,
                    method: "printing_solid",
                    presetId: row.presetId,
                    beltAngleDeg: row.beltAngleDeg,
                    layerHeightMm: row.layerHeightMm,
                    material: row.material,
                    gcodeStorageKey: null,
                    createdAt: row.createdAt,
                    status: "pending",
                    side: row.side ?? undefined,
                    idempotencyKey: row.idempotencyKey,
                    settingsFingerprint: row.settingsFingerprint,
                    error: null,
                    updatedAt: row.updatedAt,
                    leaseExpiresAt: row.leaseExpiresAt,
                    chargedAt: null,
                    exportId: null,
                },
            });
            return mapRow(created as ProductionRecord);
        } catch (error) {
            if (isUnique(error)) throw new UniqueIdempotencyError();
            throw error;
        }
    }

    async findById(id: string): Promise<CadProductionRow | null> {
        const row = await this.prisma.production.findUnique({ where: { id } });
        return row ? mapRow(row as ProductionRecord) : null;
    }

    async findByKey(idempotencyKey: string): Promise<CadProductionRow | null> {
        const row = await this.prisma.production.findUnique({ where: { idempotencyKey } });
        return row ? mapRow(row as ProductionRecord) : null;
    }

    async updateIf(
        id: string,
        predicate: (row: CadProductionRow) => boolean,
        patch: CadProductionPatch,
    ): Promise<CadProductionRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM productions WHERE id = ${id}::uuid FOR UPDATE
            `;
            if (!locked.length) return null;
            const row = await tx.production.findUnique({ where: { id } });
            if (!row || !predicate(mapRow(row as ProductionRecord))) return null;
            const updated = await tx.production.update({
                where: { id },
                data: {
                    status: patch.status,
                    error: patch.error,
                    gcodeStorageKey: patch.gcodeStorageKey,
                    updatedAt: patch.updatedAt,
                    leaseExpiresAt: patch.leaseExpiresAt,
                    chargedAt: patch.chargedAt,
                    exportId: patch.exportId,
                },
            });
            return mapRow(updated as ProductionRecord);
        });
    }

    async listByDesign(
        designId: string,
        filter: { side?: CadFootSide; presetId?: string },
    ): Promise<CadProductionRow[]> {
        const rows = await this.prisma.production.findMany({
            where: {
                designId,
                ...(filter.side ? { side: filter.side } : {}),
                ...(filter.presetId ? { presetId: filter.presetId } : {}),
            },
            orderBy: { createdAt: "desc" },
        });
        return rows.map((row) => mapRow(row as ProductionRecord));
    }
}

export interface ExistingProductionCharge {
    userId: string;
    cost: number;
    productionId: string;
    designId: string;
    exportFormat: "gcode" | "stl";
    side: CadFootSide | null;
    fileName: string;
    presetId: string;
    beltAngleDeg: number;
    layerHeightMm: number | null;
    isGcode: boolean;
    storageKey: string;
    jobId: string;
    ip: string | null;
    metadata: Record<string, unknown>;
}

interface ChargePayload {
    productionId?: string;
    exportId?: string;
    balance?: number;
    alreadyCharged?: boolean;
}

/**
 * Calls vertex_charge_existing_production. The SQL row lock charges once.
 * vertex_charge_manufacturing_hybrid is not used here and is not modified.
 */
export async function chargeExistingProduction(
    prisma: PrismaClient,
    input: ExistingProductionCharge,
): Promise<CadChargeResult> {
    const rows = await prisma.$queryRaw<Array<{ result: ChargePayload }>>`
        SELECT vertex_charge_existing_production(
            ${input.userId}::uuid,
            ${input.cost}::int,
            ${input.productionId}::uuid,
            ${input.designId}::uuid,
            ${input.exportFormat}::text,
            ${input.side}::text,
            ${input.fileName}::text,
            ${input.presetId}::text,
            ${input.beltAngleDeg}::float8,
            ${input.layerHeightMm}::float8,
            ${input.isGcode}::boolean,
            ${input.storageKey}::text,
            ${input.jobId}::text,
            ${input.ip}::text,
            ${JSON.stringify(input.metadata)}::jsonb
        ) AS result
    `;
    const result = rows[0]?.result;
    if (!result?.exportId || typeof result.balance !== "number") {
        throw new Error("Manufacturing charge failed");
    }
    return {
        exportId: result.exportId,
        balance: result.balance,
        alreadyCharged: result.alreadyCharged === true,
    };
}
