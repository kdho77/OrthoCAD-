// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Dogfood CAD-operator generateSolid plan. Mesh bytes stay internal. Output is G-code.

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import {
    bindPrintRecipeProfile,
    type PrintRecipeV1,
    printRecipeV1Schema,
} from "../../../shared/print-recipe/print-recipe.js";
import {
    assertCadOperatorTempStlKey,
    buildCadOperatorTempStlKey,
    CAD_OPERATOR_BELT_ANGLE_DEG,
    CAD_OPERATOR_BELT_MATERIAL,
    CAD_OPERATOR_BELT_PROFILE_ID,
    type CadOperatorPrincipal,
} from "../auth/cad-operator.js";
import { dogfoodDesignRead } from "../auth/dogfood-design-access.js";
import { buildHeadlessFinalizedFoot } from "../lib/finalized-mesh-runner.js";

export interface CadGeneratePlan {
    stlStorageKey: string;
    presetId: string;
    printRecipe: PrintRecipeV1;
    material: string;
    beltAngleDeg: number;
    ownerId: string;
    fingerprint: string | null;
}

function lockedRecipe(settingsJson: unknown): PrintRecipeV1 {
    const settings = readStoredDesignSettings(settingsJson);
    const parsed = printRecipeV1Schema.safeParse(settings?.printRecipe);
    return bindPrintRecipeProfile(parsed.success ? parsed.data : undefined, CAD_OPERATOR_BELT_PROFILE_ID);
}

export async function planCadOperatorGenerate(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal;
    designId: string;
    side: "left" | "right";
    outputType: "gcode" | "stl";
    useSavedDesignMesh: boolean;
    stlStorageKey: string;
    uploadStl: (key: string, bytes: Buffer) => Promise<void>;
}): Promise<CadGeneratePlan> {
    if (args.outputType !== "gcode") {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "CAD-operator manufacturing returns G-code only",
        });
    }
    const row = await args.prisma.design.findUnique({
        where: { id: args.designId },
        select: {
            id: true,
            ownerId: true,
            name: true,
            kind: true,
            pattern: true,
            method: true,
            thicknessMm: true,
            linked: true,
            unit: true,
            settingsJson: true,
            updatedAt: true,
            deletedAt: true,
            client: { select: { tenantId: true } },
            integrationLink: {
                select: { tenantId: true, source: true, externalOrderId: true, sides: true },
            },
        },
    });
    const design = dogfoodDesignRead(
        args.principal,
        row
            ? {
                  id: row.id,
                  ownerId: row.ownerId,
                  name: row.name,
                  kind: row.kind,
                  pattern: row.pattern,
                  method: row.method,
                  thicknessMm: row.thicknessMm,
                  linked: row.linked,
                  unit: row.unit,
                  settingsJson: row.settingsJson,
                  updatedAt: row.updatedAt,
                  deletedAt: row.deletedAt,
                  clientTenantId: row.client.tenantId,
                  linkTenantId: row.integrationLink?.tenantId ?? null,
                  source: row.integrationLink?.source ?? null,
                  externalOrderId: row.integrationLink?.externalOrderId ?? null,
                  sides: row.integrationLink?.sides ?? null,
              }
            : null,
    );
    if (design.method === "milling_3axis") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Milled orders are not belt G-code" });
    }
    const printRecipe = lockedRecipe(design.settingsJson);
    const shared = {
        presetId: CAD_OPERATOR_BELT_PROFILE_ID,
        printRecipe,
        material: CAD_OPERATOR_BELT_MATERIAL,
        beltAngleDeg: CAD_OPERATOR_BELT_ANGLE_DEG,
        ownerId: design.ownerId,
    };
    if (!args.useSavedDesignMesh) {
        try {
            assertCadOperatorTempStlKey(args.stlStorageKey, args.principal.credentialId);
        } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid manufacturing STL storage key" });
        }
        return { ...shared, stlStorageKey: args.stlStorageKey, fingerprint: null };
    }
    let foot: Awaited<ReturnType<typeof buildHeadlessFinalizedFoot>>;
    try {
        foot = await buildHeadlessFinalizedFoot({
            settingsJson: design.settingsJson,
            side: args.side,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message,
        });
    }
    const stlStorageKey = buildCadOperatorTempStlKey(args.principal.credentialId);
    await args.uploadStl(stlStorageKey, Buffer.from(foot.stl));
    return { ...shared, stlStorageKey, fingerprint: foot.fingerprint };
}
