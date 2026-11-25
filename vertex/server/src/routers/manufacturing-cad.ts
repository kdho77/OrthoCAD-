// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Dogfood CAD-operator generateSolid plan. Mesh bytes stay internal. Output is G-code.

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { readStoredDesignSettings } from "../../../shared/design-settings.js";
import {
    type DogfoodHardnessProvenance,
    DogfoodUserQuestion,
    decideDogfoodHardness,
    patientNameQuestion,
} from "../../../shared/dogfood-manufacturing.js";
import {
    bindPrintRecipeProfile,
    type PrintRecipeV1,
    printRecipeV1Schema,
} from "../../../shared/print-recipe/print-recipe.js";
import { vertexSliceRegional3mfEnabled } from "../../../shared/vertexslice-regional-3mf.js";
import {
    assertCadOperatorTempStlKey,
    buildCadOperatorCentralFabStlKey,
    buildCadOperatorTempStlKey,
    CAD_OPERATOR_BELT_ANGLE_DEG,
    CAD_OPERATOR_BELT_MATERIAL,
    CAD_OPERATOR_BELT_PROFILE_ID,
    type CadOperatorPrincipal,
} from "../auth/cad-operator.js";
import { dogfoodDesignRead } from "../auth/dogfood-design-access.js";
import { buildHeadlessRegional3mf } from "../lib/finalized-mesh-runner.js";
import {
    envelopeWithLoftTextMarking,
    hasActiveComposedTextMarking,
    patientDisplayName,
    resolveProductionTextMarking,
} from "../lib/integration-text-marking.js";
import { buildHeadlessFinalizedFootOffThread } from "../lib/loft-worker-pool.js";
import {
    assertLockedVertexSliceProfile,
    inspectManufacturingStl,
    resolveEnabledSliceMaterial,
} from "../lib/vertexslice-client.js";

export interface CadGeneratePlan {
    stlStorageKey: string | null;
    presetId: string;
    printRecipe: PrintRecipeV1;
    material: string;
    beltAngleDeg: number;
    ownerId: string;
    useSavedDesignMesh: boolean;
    settingsJson: unknown;
    clientFirstName: string;
    clientLastName: string;
}

const designSelect = {
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
    client: { select: { tenantId: true, firstName: true, lastName: true } },
    integrationLink: {
        select: { tenantId: true, source: true, externalOrderId: true, sides: true },
    },
} as const;

function lockedRecipe(settingsJson: unknown): PrintRecipeV1 {
    const settings = readStoredDesignSettings(settingsJson);
    const parsed = printRecipeV1Schema.safeParse(settings?.printRecipe);
    return bindPrintRecipeProfile(parsed.success ? parsed.data : undefined, CAD_OPERATOR_BELT_PROFILE_ID);
}

/** Omitted preset uses the locked insole profile. Any other id is rejected. */
export function resolveCadOperatorPreset(presetId: string | undefined): string {
    const raw = presetId?.trim() ?? "";
    if (!raw) return CAD_OPERATOR_BELT_PROFILE_ID;
    try {
        return assertLockedVertexSliceProfile(raw);
    } catch (error) {
        if (error instanceof TRPCError) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${error.message}. preset_id "${raw}" was rejected and was not substituted.`,
            });
        }
        throw error;
    }
}

export async function loadDogfoodDesign(
    prisma: PrismaClient,
    principal: CadOperatorPrincipal,
    designId: string,
) {
    const row = await prisma.design.findUnique({
        where: { id: designId },
        select: designSelect,
    });
    const design = dogfoodDesignRead(
        principal,
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
    return { row, design };
}

/**
 * Auth, text marking, and hardness. No loft and no STL upload.
 * The mesh fingerprint is not known yet. Callers hash settings instead.
 */
export async function prepareCadOperatorGenerate(args: {
    prisma: PrismaClient;
    principal: CadOperatorPrincipal;
    designId: string;
    side: "left" | "right";
    outputType: "gcode" | "stl";
    useSavedDesignMesh: boolean;
    stlStorageKey: string;
    patientName?: string;
    hardness?: string;
    presetId?: string;
    material?: string;
}): Promise<CadGeneratePlan> {
    if (args.outputType !== "gcode") {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "CAD-operator manufacturing returns G-code only",
        });
    }
    const presetId = resolveCadOperatorPreset(args.presetId);
    const material = resolveEnabledSliceMaterial(args.material, CAD_OPERATOR_BELT_MATERIAL);
    const { row, design } = await loadDogfoodDesign(args.prisma, args.principal, args.designId);
    if (design.method === "milling_3axis") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Milled orders are not belt G-code" });
    }
    const clientDisplayName = row
        ? patientDisplayName(row.client.firstName ?? "", row.client.lastName ?? "")
        : "";
    const resolved = resolveProductionTextMarking({
        settingsJson: design.settingsJson,
        patientNameOverride: args.patientName,
        clientDisplayName,
    });
    if (
        args.useSavedDesignMesh &&
        !hasActiveComposedTextMarking(resolved.textMarking, resolved.patientDisplayName, args.side)
    ) {
        throw new DogfoodUserQuestion(patientNameQuestion());
    }
    if (resolved.persisted) {
        await args.prisma.design.update({
            where: { id: args.designId },
            data: { settingsJson: resolved.envelope as object },
        });
    }
    const settingsJson = args.useSavedDesignMesh
        ? envelopeWithLoftTextMarking(resolved.envelope, resolved.patientDisplayName, args.side)
        : resolved.envelope;
    let printRecipe = lockedRecipe(settingsJson);
    if (args.useSavedDesignMesh) {
        const recorded = readStoredDesignSettings(settingsJson)?.dogfoodManufacturing as
            | DogfoodHardnessProvenance
            | undefined;
        const decision = decideDogfoodHardness({
            provenance: recorded ?? null,
            requested: args.hardness,
        });
        if (!decision.ok) throw new DogfoodUserQuestion(decision);
        printRecipe = { ...printRecipe, defaultHardness: decision.hardness };
    }
    const shared = {
        presetId,
        printRecipe,
        material,
        beltAngleDeg: CAD_OPERATOR_BELT_ANGLE_DEG,
        ownerId: design.ownerId,
        clientFirstName: row?.client.firstName ?? "",
        clientLastName: row?.client.lastName ?? "",
    };
    if (!args.useSavedDesignMesh) {
        try {
            assertCadOperatorTempStlKey(args.stlStorageKey, args.principal.credentialId);
        } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid manufacturing STL storage key" });
        }
        return { ...shared, stlStorageKey: args.stlStorageKey, useSavedDesignMesh: false, settingsJson };
    }
    return { ...shared, stlStorageKey: null, useSavedDesignMesh: true, settingsJson };
}

/**
 * Loft copy for the milling solid. Drops print text (CNC does not cut it) and
 * presents a milling row as printing_solid so the existing solid builder runs.
 * exportMode is manufacturing for both methods. The stored design is not written.
 */
export function settingsForCentralFabSolid(settingsJson: unknown): unknown {
    if (!settingsJson || typeof settingsJson !== "object") return settingsJson;
    const envelope = { ...(settingsJson as Record<string, unknown>) };
    const settings = envelope.settings;
    if (!settings || typeof settings !== "object") return settingsJson;
    const next = { ...(settings as Record<string, unknown>) };
    delete next.textMarking;
    if (next.method === "milling_3axis") next.method = "printing_solid";
    const paired = next.paired;
    if (paired && typeof paired === "object") {
        const pair = { ...(paired as Record<string, unknown>) };
        if (pair.leftMethod === "milling_3axis") pair.leftMethod = "printing_solid";
        if (pair.rightMethod === "milling_3axis") pair.rightMethod = "printing_solid";
        next.paired = pair;
    }
    envelope.settings = next;
    return envelope;
}

/** Headless loft and temp STL upload. Runs after the production id is returned. */
export async function materializeCadOperatorStl(args: {
    plan: CadGeneratePlan;
    credentialId: string;
    side: "left" | "right";
    uploadStl: (key: string, bytes: Buffer) => Promise<void>;
    /** Central-fab solid: no leader, durable key, text stripped. Belt leaves this unset. */
    centralFabSolid?: { designId: string };
}): Promise<{
    stlStorageKey: string;
    /** Loft bytes. The slicer uses these. It does not read the uploaded object back. */
    stlBytes: Uint8Array;
    meshFingerprint: string | null;
    regional3mf: { bytes: Uint8Array; regionCount: number } | null;
}> {
    // Belt and central-fab both loft the saved design. A caller storage key is not the mesh.
    // Off the request thread so a pair's other foot can loft, and so a slice poll
    // is not stalled until this loft reaches its first await.
    let foot: Awaited<ReturnType<typeof buildHeadlessFinalizedFootOffThread>>;
    try {
        foot = await buildHeadlessFinalizedFootOffThread({
            settingsJson: args.centralFabSolid
                ? settingsForCentralFabSolid(args.plan.settingsJson)
                : args.plan.settingsJson,
            side: args.side,
            includeLeader: !args.centralFabSolid,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message,
        });
    }
    const stlBytes = new Uint8Array(foot.stl);
    const mesh = inspectManufacturingStl(stlBytes);
    if (mesh.problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: mesh.problem });
    }
    const stlStorageKey = args.centralFabSolid
        ? buildCadOperatorCentralFabStlKey(args.credentialId, args.centralFabSolid.designId, args.side)
        : buildCadOperatorTempStlKey(args.credentialId);
    await args.uploadStl(stlStorageKey, Buffer.from(stlBytes));
    const regional3mf = vertexSliceRegional3mfEnabled()
        ? await buildHeadlessRegional3mf({
              settingsJson: args.plan.settingsJson,
              side: args.side,
              manufacturingStl: foot.stl,
          })
        : null;
    return { stlStorageKey, stlBytes, meshFingerprint: foot.fingerprint, regional3mf };
}
