// Frozen gate T4 / MUST-MATCH geometry. Do not edit after the freeze commit.
// Cold and warm exported STL must match the BASE oracle within 0.0 mm on
// stock SAMPLE_Top and on an engraved patient-name design, both feet.
// A second patient name must produce a different solid.
//
// GATE_CAPTURE=1 writes the oracle and is refused unless the product tree
// still matches BASE. Official grading leaves the variable unset.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, rs, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildExportStl, manufacturingFingerprintForActiveExport } from "@/lib/geometry/export-geometry";
import { validateManifold } from "@/lib/geometry/mesh-close";
import {
    manufacturingLoftStats,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import * as previewMod from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import type { Side } from "@/types";
import {
    BASE_SHA,
    check,
    ENGRAVE_NAME_A,
    ENGRAVE_NAME_B,
    git,
    MAX_VERTEX_DELTA_MM,
    maxOrderedVertexDeltaMm,
    sha256,
    triangleCount,
    vertexMultisetsMatch,
    WARM_STL_MAX_MS,
} from "./support";

const SAMPLE_TOP = resolve("vertex/public/Templates/SAMPLE_Top.glb");
const REF_DIR = resolve("validation/export_cache_no_double_engrave_gates/reference");
const MANIFEST = resolve(REF_DIR, "manifest.json");

interface StlRecord {
    sha256: string;
    triangles: number;
    euler: number;
    watertight: boolean;
    bytes: number;
}

interface Manifest {
    base: string;
    stl: Record<string, StlRecord>;
}

function onlyCase(name: string): boolean {
    const filter = process.env.GATE_STL_ONLY;
    return !filter || filter === name;
}

function assertCaptureAllowed(): void {
    const dirty = git(["diff", "--name-only", BASE_SHA, "--", "vertex", "packages", "scripts"]).trim();
    if (dirty) {
        throw new Error(`GATE_CAPTURE refused: product tree differs from ${BASE_SHA}:\n${dirty}`);
    }
}

function readManifest(): Manifest {
    if (!existsSync(MANIFEST)) {
        throw new Error("missing reference/manifest.json — run with GATE_CAPTURE=1 on BASE first");
    }
    return JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
}

function writeManifest(manifest: Manifest): void {
    mkdirSync(REF_DIR, { recursive: true });
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 4)}\n`);
}

async function prime(): Promise<void> {
    const bytes = readFileSync(SAMPLE_TOP);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    previewMod.primeSampleTopGeometry(await previewMod.sampleTopFromArrayBuffer(copy));
}

function installDesign(name: string | null, extraText = ""): void {
    const design = {
        ...createDesignWithStockPlaceholder(),
        method: "printing_solid" as const,
        textMarking: name
            ? { ...defaultTextMarking("bottom"), text: extraText, addPatientName: true as const }
            : undefined,
    };
    useDesignStore.setState({
        design,
        viewer: {
            ...useDesignStore.getState().viewer,
            wallModel: "procedural",
            wallStyle: "round",
            deviceType: "functional",
        },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
    useClientStore.setState({ clients: [], activeClientId: null, designs: [] });
    if (name) {
        const [first, last] = name.split(" ");
        useClientStore.getState().addClient({
            firstName: first ?? name,
            lastName: last ?? "SAMPLE",
            shoeSizeUs: 9,
            shoeWidth: "medium",
        });
    }
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ bottomPatternEdit: null, trimlineEdit: null });
    usePreviewLoftStatusStore.getState().reset();
    resetManufacturingSolidCache();
}

function describeStl(stl: ArrayBuffer, geometryEuler: { euler: number; watertight: boolean }): StlRecord {
    return {
        sha256: sha256(stl),
        triangles: triangleCount(stl),
        euler: geometryEuler.euler,
        watertight: geometryEuler.watertight,
        bytes: stl.byteLength,
    };
}

function manifoldOf(stl: ArrayBuffer): { euler: number; watertight: boolean } {
    const geometry = binaryStlToGeometry(stl);
    try {
        const report = validateManifold(geometry);
        return {
            euler: report.eulerCharacteristic,
            watertight: report.isWatertight === true,
        };
    } finally {
        geometry.dispose();
    }
}

function geometryMatches(actual: ArrayBuffer, oracle: ArrayBuffer): { pass: boolean; deltaMm: number } {
    const sameBytes = sha256(actual) === sha256(oracle);
    const multiset = vertexMultisetsMatch(actual, oracle);
    const sameCount = triangleCount(actual) === triangleCount(oracle);
    const identical = sameBytes || (multiset && sameCount);
    const ordered = maxOrderedVertexDeltaMm(actual, oracle);
    return { pass: identical, deltaMm: identical ? 0 : ordered };
}

async function coldExport(side: Side): Promise<{ stl: ArrayBuffer; record: StlRecord }> {
    const before = manufacturingLoftStats().built;
    const stl = await buildExportStl(side, { exportMode: "manufacturing" });
    const manifold = manifoldOf(stl);
    const record = describeStl(stl, manifold);
    if (manufacturingLoftStats().built - before < 1) {
        throw new Error(`${side} cold export did not build a solid`);
    }
    return { stl, record };
}

/** Cold export, keeping the engraved mesh Print would have stored. */
async function coldExportKeepingSolid(
    side: Side,
): Promise<{ stl: ArrayBuffer; record: StlRecord; engraved: BufferGeometry }> {
    const captured: BufferGeometry[] = [];
    const original = previewMod.buildProceduralExportSolid;
    const spy = rs
        .spyOn(previewMod, "buildProceduralExportSolid")
        .mockImplementation(async (options, cache) => {
            const result = await original(options, cache);
            captured.push(result.geometry.clone());
            return result;
        });
    try {
        const cold = await coldExport(side);
        const engraved = captured.at(-1);
        if (!engraved) throw new Error(`${side} export did not return a solid`);
        return { ...cold, engraved };
    } finally {
        spy.mockRestore();
    }
}

/**
 * Publish the already engraved mesh the way Print does, then export again.
 * That is the path that used to engrave the patient name a second time.
 */
async function warmFromPublished(
    side: Side,
    engraved: BufferGeometry,
): Promise<{ stl: ArrayBuffer; ms: number; builtDelta: number }> {
    resetManufacturingSolidCache();
    rememberManufacturingSolid(manufacturingFingerprintForActiveExport(side), side, engraved);
    const builtBefore = manufacturingLoftStats().built;
    const started = performance.now();
    const stl = await buildExportStl(side, { exportMode: "manufacturing" });
    return {
        stl,
        ms: performance.now() - started,
        builtDelta: manufacturingLoftStats().built - builtBefore,
    };
}

async function saveOracle(name: string, stl: ArrayBuffer, record: StlRecord): Promise<void> {
    mkdirSync(REF_DIR, { recursive: true });
    writeFileSync(resolve(REF_DIR, `${name}.stl`), Buffer.from(stl));
    const manifest = existsSync(MANIFEST) ? readManifest() : { base: BASE_SHA, stl: {} };
    manifest.base = BASE_SHA;
    manifest.stl[name] = record;
    writeManifest(manifest);
}

function loadOracle(name: string): { stl: ArrayBuffer; record: StlRecord } {
    const manifest = readManifest();
    const record = manifest.stl[name];
    if (!record) throw new Error(`manifest has no ${name}`);
    const bytes = readFileSync(resolve(REF_DIR, `${name}.stl`));
    const stl = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return { stl, record };
}

beforeEach(async () => {
    resetManufacturingSolidCache();
    previewMod.resetSampleTopGeometryCache();
    usePreviewLoftStatusStore.getState().reset();
    await prime();
});

describe("T4 exported STL matches main", () => {
    for (const side of ["left", "right"] as const) {
        const name = `stock-${side}`;
        test(`T4-${name} cold and warm stock STL match main`, async () => {
            if (!onlyCase(name) && !onlyCase(`T4-${name}`)) return;
            installDesign(null);
            const cold = await coldExport(side);
            const builtAfterCold = manufacturingLoftStats().built;
            const warmStarted = performance.now();
            const warmStl = await buildExportStl(side, { exportMode: "manufacturing" });
            const warmMs = performance.now() - warmStarted;
            const warmBuilt = manufacturingLoftStats().built - builtAfterCold;
            const warmManifold = manifoldOf(warmStl);
            if (process.env.GATE_CAPTURE === "1") {
                assertCaptureAllowed();
                await saveOracle(name, cold.stl, cold.record);
            }
            const capturing = process.env.GATE_CAPTURE === "1";
            const oracle = capturing ? { stl: cold.stl, record: cold.record } : loadOracle(name);
            const coldMatch = geometryMatches(cold.stl, oracle.stl);
            const warmMatch = geometryMatches(warmStl, oracle.stl);
            const pass =
                cold.record.watertight &&
                cold.record.euler === 2 &&
                warmManifold.watertight &&
                warmManifold.euler === 2 &&
                coldMatch.pass &&
                warmMatch.pass &&
                coldMatch.deltaMm <= MAX_VERTEX_DELTA_MM &&
                warmMatch.deltaMm <= MAX_VERTEX_DELTA_MM &&
                warmBuilt === 0 &&
                warmMs < WARM_STL_MAX_MS &&
                cold.record.triangles === triangleCount(warmStl);
            check({
                id: `T4-${name}`,
                rule: "TESTS-4 / R6: stock SAMPLE_Top cold and warm STL match main within 0.0 mm",
                expectOnBase: "pass",
                pass,
                measured: `coldSha=${cold.record.sha256.slice(0, 12)} warmSha=${sha256(warmStl).slice(0, 12)} tris=${cold.record.triangles} euler=${cold.record.euler} watertight=${cold.record.watertight} coldDeltaMm=${coldMatch.deltaMm} warmDeltaMm=${warmMatch.deltaMm} warmMs=${warmMs.toFixed(1)} warmBuilt=${warmBuilt}`,
                threshold: `sha matches oracle, euler=2, watertight=true, deltaMm<=${MAX_VERTEX_DELTA_MM}, warmBuilt=0, warmMs<${WARM_STL_MAX_MS}`,
            });
        });
    }

    for (const side of ["left", "right"] as const) {
        const name = `engrave-${side}`;
        test(`T4-${name} engraved patient name matches main cold and warm`, async () => {
            if (!onlyCase(name) && !onlyCase(`T4-${name}`)) return;
            installDesign(ENGRAVE_NAME_A);
            const cold = await coldExportKeepingSolid(side);
            let warmNote = "";
            let warmPass = false;
            let warmMs = 0;
            let warmSha = "";
            try {
                const warm = await warmFromPublished(side, cold.engraved);
                warmMs = warm.ms;
                warmSha = sha256(warm.stl);
                const manifold = manifoldOf(warm.stl);
                if (process.env.GATE_CAPTURE === "1") {
                    assertCaptureAllowed();
                    await saveOracle(name, cold.stl, cold.record);
                }
                const capturing = process.env.GATE_CAPTURE === "1";
                const oracle = capturing ? { stl: cold.stl, record: cold.record } : loadOracle(name);
                const coldMatch = geometryMatches(cold.stl, oracle.stl);
                const warmMatch = geometryMatches(warm.stl, oracle.stl);
                warmPass =
                    cold.record.watertight &&
                    cold.record.euler === 2 &&
                    manifold.watertight &&
                    manifold.euler === 2 &&
                    coldMatch.pass &&
                    warmMatch.pass &&
                    coldMatch.deltaMm <= MAX_VERTEX_DELTA_MM &&
                    warmMatch.deltaMm <= MAX_VERTEX_DELTA_MM &&
                    warm.builtDelta === 0 &&
                    warmMs < WARM_STL_MAX_MS;
                warmNote = `coldDeltaMm=${coldMatch.deltaMm} warmDeltaMm=${warmMatch.deltaMm} warmBuilt=${warm.builtDelta} euler=${manifold.euler} watertight=${manifold.watertight}`;
            } catch (error) {
                warmNote = `threw:${error instanceof Error ? error.message : String(error)}`;
                warmPass = false;
                if (process.env.GATE_CAPTURE === "1") {
                    assertCaptureAllowed();
                    await saveOracle(name, cold.stl, cold.record);
                }
            } finally {
                cold.engraved.dispose();
            }
            check({
                id: `T4-${name}`,
                rule: "TESTS-4 / R4 / R6: engraved patient-name STL matches main on cold and warm export",
                expectOnBase: "fail",
                pass: warmPass,
                measured: `coldSha=${cold.record.sha256.slice(0, 12)} warmSha=${warmSha.slice(0, 12)} tris=${cold.record.triangles} coldEuler=${cold.record.euler} warmMs=${warmMs.toFixed(1)} ${warmNote}`,
                threshold: `sha matches oracle, euler=2, watertight=true, deltaMm<=${MAX_VERTEX_DELTA_MM}, warmBuilt=0, warmMs<${WARM_STL_MAX_MS}, no throw`,
            });
        });
    }

    test("T4-other-name a second patient name produces a different solid", async () => {
        if (!onlyCase("other-name") && !onlyCase("T4-other-name")) return;
        installDesign(ENGRAVE_NAME_B);
        const cold = await coldExport("left");
        if (process.env.GATE_CAPTURE === "1") {
            assertCaptureAllowed();
            await saveOracle("engrave-other-left", cold.stl, cold.record);
        }
        const capturing = process.env.GATE_CAPTURE === "1";
        const selfOracle = capturing
            ? { stl: cold.stl, record: cold.record }
            : loadOracle("engrave-other-left");
        const nameA = capturing ? null : loadOracle("engrave-left");
        const selfMatch = geometryMatches(cold.stl, selfOracle.stl);
        const differsFromA = nameA ? sha256(cold.stl) !== nameA.record.sha256 : true;
        check({
            id: "T4-other-name",
            rule: "MUST-MATCH: changing the patient name produces the updated solid, still matching main",
            expectOnBase: "pass",
            pass:
                cold.record.watertight &&
                cold.record.euler === 2 &&
                selfMatch.pass &&
                selfMatch.deltaMm <= MAX_VERTEX_DELTA_MM &&
                differsFromA,
            measured: `sha=${cold.record.sha256.slice(0, 12)} tris=${cold.record.triangles} euler=${cold.record.euler} deltaMm=${selfMatch.deltaMm} differsFromGateSample=${differsFromA}`,
            threshold: `matches oracle engrave-other-left, euler=2, watertight=true, deltaMm<=${MAX_VERTEX_DELTA_MM}, sha differs from engrave-left`,
        });
    });
});
