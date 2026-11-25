// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// t2704u: production generate_gcode rematerializes from the saved design on
// every call. It does not read a stored manufacturing STL or a checkpoint STL.
// The UI preview cache is a different gate. This does not loosen G1–G4.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import {
    beginCadOperatorProduction,
    type CadProductionInsert,
    executeCadOperatorProduction,
    MemoryCadProductionStore,
    type SliceCheckpointV1,
} from "../../vertex/server/src/lib/cad-operator-production";
import { PATH_0D3DB1C0, loftEnvelope } from "./production-fixtures";

/** Known pre-#52 left archive. A production call must not slice this object. */
const STALE_STORED_STL = "stored-8f5dc451de66dbba8f8521e046a9e4af";

const INSERT: CadProductionInsert = {
    designId: "0d3db1c0",
    side: "left",
    presetId: "apex-v2-insole-95a",
    idempotencyKey: "gate-t2704u-same-design",
    settingsFingerprint: "same-saved-design",
    beltAngleDeg: 45,
    layerHeightMm: null,
    material: "apex_core",
};

function sha256(bytes: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function storedCheckpoint(now: Date, placementVersion?: number): SliceCheckpointV1 {
    const checkpoint: SliceCheckpointV1 = {
        v: 1,
        jobId: "stored-job",
        acceptedAt: now.toISOString(),
        stlStorageKey: STALE_STORED_STL,
        meshFingerprint: "stored-fingerprint",
        expectedRegionCount: 1,
        credentialId: "gate",
        serverStartedAt: null,
    };
    if (placementVersion != null) {
        (checkpoint as SliceCheckpointV1 & { placementVersion?: number }).placementVersion = placementVersion;
    }
    return checkpoint;
}

describe("production generate_gcode rematerializes", () => {
    test("two consecutive calls on the same design both loft and neither reads a stored STL", async () => {
        const envelope = loftEnvelope(PATH_0D3DB1C0, "left");
        const sampleTop = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
        const fontFile = readFileSync(resolve("vertex/public/fonts/Inter-Bold.ttf"));
        const sampleTopBytes = sampleTop.buffer.slice(sampleTop.byteOffset, sampleTop.byteOffset + sampleTop.byteLength);
        const fontBytes = fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength);
        primeTextFont(fontBytes);
        globalThis.fetch = async (input) => {
            const url = String(input);
            if (!url.includes("SAMPLE_Top")) throw new Error(`unexpected fetch ${url}`);
            return new Response(sampleTop);
        };

        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-25T07:16:00.000Z");
        const placementVersion = (
            (await import("../../vertex/server/src/lib/cad-operator-production.ts")) as {
                MANUFACTURING_STL_PLACEMENT_VERSION?: number;
            }
        ).MANUFACTURING_STL_PLACEMENT_VERSION;
        const loftHashes: string[] = [];
        const slicedKeys: string[] = [];

        const uiExportKey = async (): Promise<string> => {
            resetManufacturingSolidCache();
            const foot = await buildFinalizedFootFromSavedSettings({
                settingsJson: envelope,
                side: "left",
                sampleTopBytes,
                fontBytes,
            });
            return sha256(foot.stl);
        };

        const generate = async () => {
            const jobs: Promise<void>[] = [];
            await beginCadOperatorProduction({
                store,
                now,
                insert: INSERT,
                schedule: (work) => {
                    jobs.push(work);
                },
                execute: (row) =>
                    executeCadOperatorProduction({
                        row,
                        store,
                        now: () => now,
                        materialize: async () => {
                            const meshFingerprint = await uiExportKey();
                            loftHashes.push(meshFingerprint);
                            return { stlStorageKey: `ui-export-${meshFingerprint}`, meshFingerprint };
                        },
                        slice: async (stlStorageKey) => {
                            slicedKeys.push(stlStorageKey);
                            if (slicedKeys.length === 1) {
                                return { pending: true, checkpoint: storedCheckpoint(now, placementVersion) };
                            }
                            return { gcode: "G1 X0 Y0 E1\n", jobId: `job-${slicedKeys.length}` };
                        },
                        uploadGcode: async () => ({ storageKey: "gcode/gate" }),
                        charge: async () => ({ exportId: "gate-export", balance: 1, alreadyCharged: false }),
                    }),
            });
            await Promise.all(jobs);
        };

        await generate();
        await generate();

        const row = await store.findByKey(INSERT.idempotencyKey);
        expect(row?.error ?? "").toContain("slice-checkpoint");
        expect(loftHashes).toHaveLength(2);
        expect(slicedKeys).toHaveLength(2);
        expect(new Set(loftHashes).size).toBe(1);
        expect(slicedKeys).toEqual(loftHashes.map((hash) => `ui-export-${hash}`));
        expect(slicedKeys).not.toContain(STALE_STORED_STL);
    }, 300_000);
});
