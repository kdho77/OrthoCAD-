// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// t2699u: the stored manufacturing STL, the slice checkpoint, and
// manufacturingSolidIdentity must change when any saved-design field changes.
// A no-op control still reuses. This does not loosen the plantar-name gates.

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { designStateFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { baseModifierFieldAuthoritative, getDesignBase } from "@/lib/geometry/base-asset";
import { manufacturingFingerprintForActiveExport } from "@/lib/geometry/export-geometry";
import {
    manufacturingSolidFingerprint,
    peekManufacturingSolid,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { manufacturingCacheContext } from "@/lib/geometry/procedural-wall/manufacturing-solid-context";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import { useDesignStore } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import {
    encodeSliceCheckpoint,
    readSliceCheckpoint,
} from "../../vertex/server/src/lib/cad-operator-production";
import { designSettingsEnvelope } from "../../vertex/shared/design-settings";
import { PATH_0D3DB1C0, loftEnvelope } from "./production-fixtures";

const SIDE: Side = "left";

interface IdentityRow {
    field: string;
    storedStlReused: boolean;
    checkpointReused: boolean;
    solidIdentityReused: boolean;
    error?: string;
}

function sentinelGeometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    return geometry;
}

function install(design: DesignState): void {
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({
        design,
        viewer: { ...viewer, wallModel: "procedural" },
    });
}

function baselineDesign(): DesignState {
    return designStateFromSavedSettings(loftEnvelope(PATH_0D3DB1C0, SIDE));
}

/** Persist through the same envelope Export saves, then read it back. */
function roundTrip(settings: DesignState): DesignState {
    return designStateFromSavedSettings(
        designSettingsEnvelope(jsonClone(settings) as unknown as Record<string, unknown>),
    );
}

function jsonClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Every saved-design leaf, including empty arrays and empty objects. */
function leafPaths(value: unknown, prefix = ""): string[] {
    if (value === null || typeof value !== "object") return prefix ? [prefix] : [];
    if (Array.isArray(value)) {
        if (value.length === 0) return prefix ? [prefix] : [];
        return value.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`));
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) return prefix ? [prefix] : [];
    return keys.flatMap((key) => leafPaths(record[key], prefix ? `${prefix}.${key}` : key));
}

function readPath(root: unknown, path: string): unknown {
    const tokens = path.split(".").flatMap((part) => {
        const out: Array<string | number> = [];
        const re = /([^[\]]+)|\[(\d+)\]/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(part))) {
            if (match[1] != null) out.push(match[1]);
            else out.push(Number(match[2]));
        }
        return out;
    });
    let cursor: unknown = root;
    for (const token of tokens) {
        if (cursor == null || typeof cursor !== "object") return undefined;
        cursor = (cursor as Record<string | number, unknown>)[token];
    }
    return cursor;
}

function writePath(root: unknown, path: string, next: unknown): void {
    const tokens = path.split(".").flatMap((part) => {
        const out: Array<string | number> = [];
        const re = /([^[\]]+)|\[(\d+)\]/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(part))) {
            if (match[1] != null) out.push(match[1]);
            else out.push(Number(match[2]));
        }
        return out;
    });
    let cursor: unknown = root;
    for (let i = 0; i < tokens.length - 1; i++) {
        cursor = (cursor as Record<string | number, unknown>)[tokens[i]!];
    }
    (cursor as Record<string | number, unknown>)[tokens[tokens.length - 1]!] = next;
}

function mutatedLeaf(value: unknown): unknown {
    if (typeof value === "number") return Number.isFinite(value) ? value + 1 : 1;
    if (typeof value === "boolean") return !value;
    if (typeof value === "string") return `${value}X`;
    if (value === null) return 1;
    if (Array.isArray(value)) return [...value, { id: "gate-field", kind: "met_pad" }];
    if (value && typeof value === "object") return { ...(value as Record<string, unknown>), gateField: 1 };
    return "gate";
}

function solidOptions(design: DesignState, beltPrint: boolean) {
    const base = getDesignBase(design, SIDE);
    if (!base) throw new Error("saved design has no base");
    const viewer = useDesignStore.getState().viewer;
    const field = baseModifierFieldAuthoritative(design, SIDE, design.thicknessMm);
    const options = {
        ...printSolidOptions({
            design,
            side: SIDE,
            field,
            viewer,
            trimline: null,
            bottomPattern: null,
        }),
        mirrored: Boolean(base.mirrored),
        ...(beltPrint ? { beltPrint: true as const } : {}),
    };
    const cache = manufacturingCacheContext({
        design,
        side: SIDE,
        baseAssetId: base.assetId ?? "",
        mirrored: Boolean(base.mirrored),
    });
    return { options, cache };
}

type RunIdentity = (input: { side: Side; composedText: string; beltPrint: boolean }) => string;

let runIdentity: RunIdentity | null | undefined;

const RUN_IDENTITY_FILE = resolve("vertex/server/src/lib/manufacturing-stl-identity.ts");

/** Present only when a worker added a separate checkpoint key. Missing on BASE. */
async function loadRunIdentity(): Promise<RunIdentity | null> {
    if (runIdentity !== undefined) return runIdentity;
    if (!existsSync(RUN_IDENTITY_FILE)) {
        runIdentity = null;
        return runIdentity;
    }
    const mod = await import("../../vertex/server/src/lib/manufacturing-stl-identity.ts");
    runIdentity = typeof mod.manufacturingStlRunIdentity === "function" ? mod.manufacturingStlRunIdentity : null;
    return runIdentity;
}

function composedSavedText(design: DesignState): string {
    const text = design.textMarking?.text;
    return typeof text === "string" ? text : "";
}

function checkpointFor(meshFingerprint: string): string | null {
    const encoded = encodeSliceCheckpoint({
        v: 1,
        jobId: "gate-job",
        acceptedAt: "2026-11-25T06:00:00.000Z",
        stlStorageKey: "stored-manufacturing-stl",
        meshFingerprint,
        expectedRegionCount: 1,
        credentialId: "gate",
        serverStartedAt: null,
    });
    return readSliceCheckpoint(encoded)?.meshFingerprint ?? null;
}

function measure(
    design: DesignState,
    storedFingerprint: string,
    storedRun: string | null,
    identity: RunIdentity | null,
): Omit<IdentityRow, "field"> {
    install(design);
    try {
        const fingerprint = manufacturingFingerprintForActiveExport(SIDE);
        const same = fingerprint === storedFingerprint;
        const runSame =
            identity != null &&
            storedRun != null &&
            identity({ side: SIDE, composedText: composedSavedText(design), beltPrint: true }) === storedRun;
        return {
            storedStlReused: peekManufacturingSolid(fingerprint, SIDE) != null,
            checkpointReused: checkpointFor(storedFingerprint) === fingerprint || runSame,
            solidIdentityReused: same,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            storedStlReused: false,
            checkpointReused: false,
            solidIdentityReused: false,
            error: message,
        };
    }
}

describe("full saved-design manufacturing identity", () => {
    test("no-op reuses the stored STL when the saved design is unchanged", async () => {
        resetManufacturingSolidCache();
        const design = baselineDesign();
        install(design);
        const fingerprint = manufacturingFingerprintForActiveExport(SIDE);
        rememberManufacturingSolid(fingerprint, SIDE, sentinelGeometry());
        const identity = await loadRunIdentity();
        const storedRun = identity?.({ side: SIDE, composedText: composedSavedText(design), beltPrint: true }) ?? null;
        install(roundTrip(design));
        const again = manufacturingFingerprintForActiveExport(SIDE);
        expect(again).toBe(fingerprint);
        expect(peekManufacturingSolid(again, SIDE)).not.toBeNull();
        expect(checkpointFor(fingerprint)).toBe(again);
        if (identity && storedRun) {
            expect(identity({ side: SIDE, composedText: composedSavedText(useDesignStore.getState().design), beltPrint: true })).toBe(
                storedRun,
            );
        }
    });

    test("any single design-field change misses the stored STL", async () => {
        resetManufacturingSolidCache();
        const design = baselineDesign();
        install(design);
        const storedFingerprint = manufacturingFingerprintForActiveExport(SIDE);
        rememberManufacturingSolid(storedFingerprint, SIDE, sentinelGeometry());
        const identity = await loadRunIdentity();
        const storedRun = identity?.({ side: SIDE, composedText: composedSavedText(design), beltPrint: true }) ?? null;
        const saved = roundTrip(design);
        const paths = leafPaths(designSettingsEnvelope(jsonClone(saved) as unknown as Record<string, unknown>).settings);
        const rows: IdentityRow[] = [];

        for (const field of paths) {
            const next = jsonClone(saved);
            const before = readPath(next, field);
            const after = mutatedLeaf(before);
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            writePath(next, field, after);
            const row = measure(roundTrip(next), storedFingerprint, storedRun, identity);
            rows.push({ field, ...row });
        }

        for (const field of ["sinks", "sinkStyloidThicken"] as const) {
            if (paths.includes(field)) continue;
            const next = jsonClone(saved);
            (next as unknown as Record<string, unknown>)[field] =
                field === "sinks" ? { left: [{ id: "gate-sink", kind: "styloid" }], right: [] } : true;
            rows.push({ field, ...measure(roundTrip(next), storedFingerprint, storedRun, identity) });
        }

        const beltOff = solidOptions(design, false);
        const beltOn = solidOptions(design, true);
        const beltFingerprint = manufacturingSolidFingerprint(beltOn.options, beltOn.cache);
        const beltSame = manufacturingSolidFingerprint(beltOff.options, beltOff.cache) === beltFingerprint;
        rows.push({
            field: "beltPrint",
            storedStlReused: beltSame,
            checkpointReused: beltSame,
            solidIdentityReused: beltSame,
        });

        const versionOff = manufacturingSolidFingerprint(beltOn.options, beltOn.cache);
        const versionOn = manufacturingSolidFingerprint(beltOn.options, {
            ...beltOn.cache,
            geometryVersion: beltOn.cache.geometryVersion + 1,
        });
        rows.push({
            field: "slicerOrthoCadVersion",
            storedStlReused: versionOn === versionOff,
            checkpointReused: versionOn === versionOff,
            solidIdentityReused: versionOn === versionOff,
        });

        writeFileSync("/tmp/full-design-identity.json", JSON.stringify(rows, null, 2));
        const reused = rows.filter((row) => row.storedStlReused || row.checkpointReused || row.solidIdentityReused);
        expect(reused.map((row) => row.field)).toEqual([]);
    });
});
