// Independent computational-geometry grader for PR #497 @ 8c9137ff.
// Do not merge. This file does not change worker geometry.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { buildFinalizedFootFromSavedDesign } from "@/features/exports/saved-design-finalized-mesh";
import { meshYSign } from "@/lib/geometry/handedness";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { anteriorRimIsBluntCut } from "@/lib/geometry/procedural-wall/bottom-pattern";
import { plantarNameEngraved } from "@/lib/geometry/procedural-wall/manufacturing-foot-guard";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import {
    POSTLOFT_DIHEDRAL_MAX_DEG,
    PRELOFT_HEADING_MAX_DEG,
    SKEW_INSET_RATIO,
} from "@/lib/geometry/procedural-wall/station-gates";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { composeMarkingTextForSide } from "@/lib/geometry/text-marking/compose";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { buildTrimPresetCurve, TRIM_PRESET_LANDMARK_U } from "@/lib/geometry/trim-presets";
import { extractMeshOutline, serializeTrimlineCurve } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, Side, TrimPresetId } from "@/types";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const PR = "8c9137ff86ca53fbc639333e925e6eeadc47bddf";
const SAMPLE = join(REPO_ROOT, "tests/fixtures/SAMPLE_Top.glb");
const FONT = join(REPO_ROOT, "vertex/public/fonts/Inter-Bold.ttf");

/** Files the PR commit itself is allowed to touch. */
const PR_FILES = [
    "ci/unit-test-shards.json",
    "vertex/src/lib/geometry/procedural-wall/bottom-pattern.ts",
    "vertex/src/lib/geometry/procedural-wall/print-solid-compose.ts",
    "vertex/src/lib/geometry/procedural-wall/quad-grid.ts",
    "vertex/src/lib/geometry/procedural-wall/reconstruct.ts",
    "vertex/src/lib/geometry/procedural-wall/short-trim-preloft.test.ts",
] as const;

const GATES_UNTOUCHED = [
    "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
    "vertex/src/lib/geometry/trim-presets.ts",
] as const;

/**
 * Frozen shape gates. Landmark u is the medial end of the cut (full 1,
 * sulcus 0.72, met-head 0.66), so the solid should lose about 28% and 34%
 * of its length. The band allows the 0.25 mm margin, 1.5 mm anterior
 * simplify, and 12 mm fillet the clip actually cuts on.
 */
const MET_REDUCTION = { min: 0.28, max: 0.4 };
const SULCUS_REDUCTION = { min: 0.22, max: 0.34 };
const MIN_SULCUS_LONGER_MM = 8;
const MIN_OBLIQUE_MM = 8;
const MIN_HEEL_CUP_MM = 8;
const HEEL_MATCH_FULL_MM = 2;
/** Same posterior millimetres on every trim. A fraction of the short sole stops before the cup wall. */
const HEEL_WINDOW_MM = 55;

const originalFetch = globalThis.fetch;

function git(args: string[], encoding: "utf8" = "utf8") {
    const result = spawnSync("git", args, {
        cwd: REPO_ROOT,
        encoding,
        maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

function sha256(bytes: Buffer | Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function payload(stl: ArrayBuffer): Buffer {
    return Buffer.from(stl).subarray(80);
}

interface OutlinePoint {
    x: number;
    y: number;
}

function footprintOf(points: OutlinePoint[]) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { lengthMm: maxX - minX, widthMm: maxY - minY };
}

function installDesign(design: DesignState, sampleBytes: ArrayBuffer, patient: boolean) {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null });
    const font = readFileSync(FONT);
    primeTextFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
    globalThis.fetch = async () => new Response(readFileSync(SAMPLE));
    if (patient) {
        useClientStore.setState({
            activeClientId: "grader-patient",
            clients: [{ id: "grader-patient", firstName: "Ada", lastName: "Grade" } as never],
        });
    } else {
        useClientStore.setState({ activeClientId: null, clients: [] });
    }
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
    if (!primedNative) throw new Error("SAMPLE_Top was not parsed");
    // resetSampleTopGeometryCache disposes the cached mesh. Prime a clone.
    primeSampleTopGeometry(primedNative.clone());
    void sampleBytes;
}

let primedNative: Awaited<ReturnType<typeof sampleTopFromArrayBuffer>> | null = null;

interface ShapeReport {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    minZ: number;
    heelCupMm: number;
    toeWallMm: number;
    medialLeadMm: number;
    contactCount: number;
    contactSpanX: number;
    contactSpanY: number;
    contactZRange: number;
    degenerate: number;
    signedVolumeMm3: number;
}

function shapeOf(geometry: BufferGeometry, side: Side): ShapeReport {
    const pos = geometry.getAttribute("position");
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const lengthMm = maxX - minX;
    const widthMm = maxY - minY;
    const medial = meshYSign(side, "medial");
    const outerBand = widthMm * 0.18;
    let medMaxX = -Infinity;
    let latMaxX = -Infinity;
    let heelZ = -Infinity;
    let toeZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x < minX + HEEL_WINDOW_MM) heelZ = Math.max(heelZ, z);
        if (lengthMm > 1e-6 && (x - minX) / lengthMm > 0.8) toeZ = Math.max(toeZ, z);
        const medialOuter = medial < 0 ? y <= minY + outerBand : y >= maxY - outerBand;
        const lateralOuter = medial < 0 ? y >= maxY - outerBand : y <= minY + outerBand;
        if (medialOuter) medMaxX = Math.max(medMaxX, x);
        if (lateralOuter) latMaxX = Math.max(latMaxX, x);
    }
    let cMinX = Infinity;
    let cMaxX = -Infinity;
    let cMinY = Infinity;
    let cMaxY = -Infinity;
    let cMinZ = Infinity;
    let cMaxZ = -Infinity;
    let contactCount = 0;
    let degenerate = 0;
    let signed = 0;
    for (let t = 0; t + 2 < pos.count; t += 3) {
        const ax = pos.getX(t);
        const ay = pos.getY(t);
        const az = pos.getZ(t);
        const bx = pos.getX(t + 1);
        const by = pos.getY(t + 1);
        const bz = pos.getZ(t + 1);
        const cx = pos.getX(t + 2);
        const cy = pos.getY(t + 2);
        const cz = pos.getZ(t + 2);
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = cx - ax;
        const vy = cy - ay;
        const vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz < 1e-18) degenerate++;
        signed += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
        for (const [x, y, z] of [
            [ax, ay, az],
            [bx, by, bz],
            [cx, cy, cz],
        ] as const) {
            if (z <= minZ + 0.08) {
                contactCount++;
                if (x < cMinX) cMinX = x;
                if (x > cMaxX) cMaxX = x;
                if (y < cMinY) cMinY = y;
                if (y > cMaxY) cMaxY = y;
                if (z < cMinZ) cMinZ = z;
                if (z > cMaxZ) cMaxZ = z;
            }
        }
    }
    return {
        lengthMm,
        widthMm,
        heightMm: maxZ - minZ,
        minZ,
        heelCupMm: heelZ - minZ,
        toeWallMm: toeZ - minZ,
        medialLeadMm: medMaxX - latMaxX,
        contactCount,
        contactSpanX: cMaxX - cMinX,
        contactSpanY: cMaxY - cMinY,
        contactZRange: cMaxZ - cMinZ,
        degenerate,
        signedVolumeMm3: signed / 6,
    };
}

function positionsOf(geometry: BufferGeometry): Float32Array {
    return geometry.getAttribute("position").array as Float32Array;
}

interface BuiltSolid {
    payloadSha: string;
    fullSha: string;
    solidTriangles: number;
    uploadTriangles: number;
    byteLength: number;
    shape: ShapeReport;
    manifold: ReturnType<typeof validateManifold>;
    engraved: boolean;
}

async function buildSolid(
    design: DesignState,
    sampleBytes: ArrayBuffer,
    side: Side,
    includeLeader: boolean,
    patient: boolean,
): Promise<BuiltSolid> {
    installDesign(design, sampleBytes, patient);
    const built = await buildPrinterFootManufacturingStl(side, includeLeader);
    const geometry = binaryStlToGeometry(built.stl);
    try {
        const view = new DataView(built.stl);
        const declared = view.getUint32(80, true);
        if (built.stl.byteLength !== 84 + declared * 50) {
            throw new Error(`${side} STL byte length does not match the triangle count`);
        }
        const shape = shapeOf(geometry, side);
        const rim = design.trimlines?.[side] ?? [];
        return {
            payloadSha: sha256(payload(built.stl)),
            fullSha: sha256(Buffer.from(built.stl)),
            solidTriangles: built.solidTriangles,
            uploadTriangles: built.uploadTriangles,
            byteLength: built.stl.byteLength,
            shape,
            manifold: validateManifold(geometry),
            engraved: plantarNameEngraved(positionsOf(geometry), rim),
        };
    } finally {
        geometry.dispose();
    }
}

function linkNodeModules(dir: string) {
    for (const rel of ["node_modules", "vertex/node_modules"]) {
        const dest = join(dir, rel);
        if (existsSync(dest)) continue;
        mkdirSync(join(dest, ".."), { recursive: true });
        symlinkSync(join(REPO_ROOT, rel), dest);
    }
}

function ensureWorktree(commit: string): string {
    const dir = `/tmp/pr497-wt-${commit.slice(0, 12)}`;
    if (!existsSync(join(dir, "package.json"))) {
        const added = spawnSync("git", ["worktree", "add", "--detach", dir, commit], {
            cwd: REPO_ROOT,
            encoding: "utf8",
        });
        if (added.status !== 0) {
            throw new Error(`worktree ${commit}: ${added.stderr || added.stdout}`);
        }
    }
    linkNodeModules(dir);
    return dir;
}

const PROBE_SOURCE = `import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "@rstest/core";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import * as bottomPattern from "@/lib/geometry/procedural-wall/bottom-pattern";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";

const SAMPLE = resolve("tests/fixtures/SAMPLE_Top.glb");
const FONT = resolve("vertex/public/fonts/Inter-Bold.ttf");

describe("PR 497 baseline full-length hashes", () => {
    test("left and right US M9 SAMPLE_Top, no trim", async () => {
        const bytes = readFileSync(SAMPLE);
        const sample = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const native = await sampleTopFromArrayBuffer(sample);
        const font = readFileSync(FONT);
        const out = {};
        for (const side of ["left", "right"]) {
            resetManufacturingSolidCache();
            resetSampleTopGeometryCache();
            useBottomPatternStore.getState().clear();
            useMeshEditStore.setState({ trimlineEdit: null });
            useClientStore.setState({ activeClientId: null, clients: [] });
            primeTextFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
            globalThis.fetch = async () => new Response(bytes);
            const design = createDesignWithStockPlaceholder();
            design.method = "printing_solid";
            useDesignStore.setState({
                design,
                viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
            });
            primeSampleTopGeometry(native.clone());
            const built = await buildPrinterFootManufacturingStl(side, false);
            const payload = Buffer.from(built.stl).subarray(80);
            out[side] = {
                payloadSha: createHash("sha256").update(payload).digest("hex"),
                fullSha: createHash("sha256").update(Buffer.from(built.stl)).digest("hex"),
                solidTriangles: built.solidTriangles,
                uploadTriangles: built.uploadTriangles,
                usMenSize: design.usMenSize,
                trim: design.trimlines ?? null,
            };
        }
        const reconstruct = readFileSync("vertex/src/lib/geometry/procedural-wall/reconstruct.ts");
        writeFileSync(process.env.PR497_HASH_OUT, JSON.stringify({
            hasBluntCut: typeof bottomPattern.anteriorRimIsBluntCut === "function",
            reconstructSha: createHash("sha256").update(reconstruct).digest("hex"),
            out,
        }));
    }, 420000);
});
`;

interface BaselineFile {
    hasBluntCut: boolean;
    reconstructSha: string;
    out: Record<
        Side,
        {
            payloadSha: string;
            fullSha: string;
            solidTriangles: number;
            uploadTriangles: number;
            usMenSize: number;
            trim: unknown;
        }
    >;
}

function baselineFull(commit: string): BaselineFile {
    const dir = ensureWorktree(commit);
    const probe = join(dir, "vertex/tests/_pr497_parent_probe.test.ts");
    writeFileSync(probe, PROBE_SOURCE);
    const outPath = `/tmp/pr497-full-${commit.slice(0, 12)}.json`;
    const env = { ...process.env, CI: "1", PR497_HASH_OUT: outPath };
    for (const key of Object.keys(env)) {
        if (key.startsWith("RSTEST") || key.startsWith("VITEST")) delete env[key];
    }
    const result = spawnSync(
        join(dir, "node_modules/.bin/rstest"),
        ["run", "--pool.maxWorkers", "1", "vertex/tests/_pr497_parent_probe.test.ts"],
        { cwd: dir, env, encoding: "utf8", timeout: 420_000, maxBuffer: 32 * 1024 * 1024 },
    );
    if (result.status !== 0) {
        throw new Error(
            `baseline ${commit} exit ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
        );
    }
    const parsed = JSON.parse(readFileSync(outPath, "utf8")) as BaselineFile;
    const expected = sha256(
        Buffer.from(git(["show", `${commit}:vertex/src/lib/geometry/procedural-wall/reconstruct.ts`])),
    );
    if (parsed.reconstructSha !== expected) {
        throw new Error(`baseline ${commit} worktree reconstruct.ts is not that commit`);
    }
    if (parsed.hasBluntCut) {
        throw new Error(
            `baseline ${commit} loaded PR-only anteriorRimIsBluntCut; the worktree bundled the wrong tree`,
        );
    }
    return parsed;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
    primedNative?.dispose();
    primedNative = null;
});

describe("PR #497 grader", () => {
    test("G1 landmarks, S1-PRELOFT thresholds, and diff scope at 8c9137ff", () => {
        const parent = git(["rev-parse", `${PR}^`]).trim();
        expect(parent).toBe("91e0062a7fd1de564b7d8b9f14b869a752464a7b");
        const changed = git(["diff", "--name-only", parent, PR])
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .sort();
        expect(changed).toEqual([...PR_FILES].sort());
        for (const path of GATES_UNTOUCHED) {
            expect(git(["show", `${PR}:${path}`])).toBe(git(["show", `${parent}:${path}`]));
            expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(git(["show", `${PR}:${path}`]));
        }
        for (const path of PR_FILES) {
            if (path === "ci/unit-test-shards.json") continue;
            expect(readFileSync(join(REPO_ROOT, path), "utf8")).toBe(git(["show", `${PR}:${path}`]));
        }
        expect(TRIM_PRESET_LANDMARK_U).toEqual({ full: 1, sulcus: 0.72, met_head: 0.66 });
        expect(PRELOFT_HEADING_MAX_DEG).toBe(15);
        expect(SKEW_INSET_RATIO).toBe(0.5);
        expect(POSTLOFT_DIHEDRAL_MAX_DEG).toBe(150);
        const gates = readFileSync(
            join(REPO_ROOT, "vertex/src/lib/geometry/procedural-wall/station-gates.ts"),
            "utf8",
        );
        expect(gates).toContain("[S1-PRELOFT]");
        expect(gates).toContain("PRELOFT_HEADING_MAX_DEG + 1e-3");
        expect(gates).toContain(">15");
        const reconstruct = readFileSync(
            join(REPO_ROOT, "vertex/src/lib/geometry/procedural-wall/reconstruct.ts"),
            "utf8",
        );
        expect(reconstruct).toContain("assertPreLoftStations(stations, r1, r2, stationSkewOpts);");
        expect(typeof anteriorRimIsBluntCut).toBe("function");

        const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "ci/unit-test-shards.json"), "utf8")) as {
            shardCount: number;
            shards: Array<{ files: string[] }>;
        };
        const files = manifest.shards.flatMap((shard) => shard.files);
        expect(manifest.shardCount).toBe(manifest.shards.length);
        expect(new Set(files).size).toBe(files.length);
        expect(files).toContain("vertex/tests/pr497-short-trim-preloft.grader.test.ts");
        expect(files).toContain("vertex/src/lib/geometry/procedural-wall/short-trim-preloft.test.ts");
    });

    test("G2-G5 full-length bytes, short-trim manifold, shape, and headless parity", async () => {
        const parent = git(["rev-parse", `${PR}^`]).trim();
        const mainTip = git(["rev-parse", "main"]).trim();
        const bytes = readFileSync(SAMPLE);
        const sampleBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        primedNative = await sampleTopFromArrayBuffer(sampleBytes);
        const mirrored = mirrorGeometry(primedNative.clone());
        const leftOutline = extractMeshOutline(primedNative, 64);
        const rightOutline = extractMeshOutline(mirrored, 64);
        mirrored.dispose();
        if (!leftOutline || !rightOutline) throw new Error("SAMPLE_Top outline missing");
        const leftFoot = footprintOf(leftOutline.points);
        const rightFoot = footprintOf(rightOutline.points);

        const curveFor = (preset: "sulcus" | "met_head", side: Side) => {
            const base = side === "left" ? leftOutline : rightOutline;
            const foot = side === "left" ? leftFoot : rightFoot;
            return buildTrimPresetCurve(preset, {
                lengthMm: foot.lengthMm,
                widthMm: foot.widthMm,
                baseCurve: base,
                footSide: side,
            });
        };
        const marking = {
            ...defaultTextMarking("bottom"),
            text: "ADA",
            addPatientName: true,
            capHeightMm: 4,
            capHeightUserSet: true,
        };
        const designFor = (preset: TrimPresetId, patient: boolean): DesignState => {
            const base = createDesignWithStockPlaceholder();
            if (!patient) return { ...base, method: "printing_solid" };
            return {
                ...base,
                method: "printing_solid",
                textMarking: marking,
                trimPreset: { left: preset, right: preset },
                trimlines: {
                    left: serializeTrimlineCurve(curveFor(preset as "sulcus" | "met_head", "left")),
                    right: serializeTrimlineCurve(curveFor(preset as "sulcus" | "met_head", "right")),
                },
            };
        };

        const parentBase = baselineFull(parent);
        const mainBase = baselineFull(mainTip);
        const failures: string[] = [];
        const check = (ok: boolean, message: string) => {
            if (!ok) failures.push(message);
        };

        const full: Record<Side, BuiltSolid> = {
            left: await buildSolid(designFor("full", false), sampleBytes, "left", false, false),
            right: await buildSolid(designFor("full", false), sampleBytes, "right", false, false),
        };
        for (const side of ["left", "right"] as const) {
            const got = full[side];
            const prior = parentBase.out[side];
            check(
                prior.usMenSize === 9 && got.shape.lengthMm > got.shape.widthMm,
                `${side} full is not a US M9 length-wise foot`,
            );
            check(prior.trim == null, `${side} parent full carried a trimline`);
            check(
                got.payloadSha === prior.payloadSha,
                `${side} full payload != parent ${parent.slice(0, 8)}`,
            );
            check(got.fullSha === prior.fullSha, `${side} full STL bytes != parent ${parent.slice(0, 8)}`);
            check(got.solidTriangles === prior.solidTriangles, `${side} full triangle count != parent`);
            check(
                got.uploadTriangles === got.solidTriangles,
                `${side} full no-leader upload added triangles`,
            );
            check(got.manifold.isWatertight, `${side} full is not watertight`);
            check(
                got.manifold.eulerCharacteristic === 2,
                `${side} full chi=${got.manifold.eulerCharacteristic}`,
            );
            check(
                got.manifold.openEdges === 0 && got.manifold.nonManifoldEdges === 0,
                `${side} full edges open`,
            );
        }

        const composed = composeMarkingTextForSide(marking, "left", "Ada Grade");
        check(
            composed.includes("ADA GRADE") && composed.includes("ADA"),
            `composed marking was ${JSON.stringify(composed)}`,
        );

        const short: Record<string, BuiltSolid> = {};
        const parity: Record<string, { ui: string; headless: string; leaderUi: number; leaderHead: number }> =
            {};
        for (const preset of ["met_head", "sulcus"] as const) {
            for (const side of ["left", "right"] as const) {
                const label = `${preset} ${side}`;
                const design = designFor(preset, true);
                let bare: BuiltSolid;
                try {
                    bare = await buildSolid(design, sampleBytes, side, false, true);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`${label} no-leader build failed: ${message}`, { cause: error });
                }
                short[label] = bare;
                const report = bare.manifold;
                check(report.isWatertight, `${label} not watertight`);
                check(report.eulerCharacteristic === 2, `${label} chi=${report.eulerCharacteristic}`);
                check(report.openEdges === 0, `${label} openEdges=${report.openEdges}`);
                check(report.nonManifoldEdges === 0, `${label} nonManifold=${report.nonManifoldEdges}`);
                check(bare.shape.degenerate === 0, `${label} degenerate=${bare.shape.degenerate}`);
                check(
                    bare.shape.signedVolumeMm3 > 10_000,
                    `${label} signed volume ${bare.shape.signedVolumeMm3.toFixed(0)}`,
                );
                check(bare.engraved, `${label} plantar name was not engraved`);
                check(bare.uploadTriangles === bare.solidTriangles, `${label} no-leader upload grew`);

                const fullShape = full[side].shape;
                const reduction = 1 - bare.shape.lengthMm / fullShape.lengthMm;
                const band = preset === "met_head" ? MET_REDUCTION : SULCUS_REDUCTION;
                check(
                    reduction >= band.min && reduction <= band.max,
                    `${label} length reduction ${(reduction * 100).toFixed(1)}% outside ${(band.min * 100).toFixed(0)}-${(band.max * 100).toFixed(0)}`,
                );
                check(bare.shape.lengthMm > bare.shape.widthMm, `${label} length is not the long axis`);
                check(
                    Math.abs(bare.shape.minZ) <= 0.25,
                    `${label} plantar minZ=${bare.shape.minZ.toFixed(3)}`,
                );
                check(
                    bare.shape.contactCount >= 500,
                    `${label} plantar contact count ${bare.shape.contactCount}`,
                );
                check(
                    bare.shape.contactSpanX >= bare.shape.lengthMm * 0.65,
                    `${label} plantar contact span X ${bare.shape.contactSpanX.toFixed(1)}`,
                );
                check(
                    bare.shape.contactSpanY >= bare.shape.widthMm * 0.45,
                    `${label} plantar contact span Y ${bare.shape.contactSpanY.toFixed(1)}`,
                );
                check(
                    bare.shape.contactZRange <= 0.08,
                    `${label} plantar z range ${bare.shape.contactZRange.toFixed(3)}`,
                );
                check(
                    bare.shape.heelCupMm >= MIN_HEEL_CUP_MM,
                    `${label} heel cup ${bare.shape.heelCupMm.toFixed(2)} mm`,
                );
                check(
                    Math.abs(bare.shape.heelCupMm - fullShape.heelCupMm) <= HEEL_MATCH_FULL_MM,
                    `${label} heel cup ${bare.shape.heelCupMm.toFixed(2)} vs full ${fullShape.heelCupMm.toFixed(2)}`,
                );
                check(
                    bare.shape.heelCupMm > bare.shape.toeWallMm + 1,
                    `${label} heel is not taller than the cut`,
                );
                if (preset === "sulcus") {
                    check(
                        bare.shape.medialLeadMm >= MIN_OBLIQUE_MM,
                        `${label} outer medial lead ${bare.shape.medialLeadMm.toFixed(2)} mm`,
                    );
                }

                const led = await buildSolid(design, sampleBytes, side, true, true);
                check(led.uploadTriangles > led.solidTriangles, `${label} leader did not add triangles`);
                check(led.byteLength > bare.byteLength, `${label} leader STL is not larger`);

                installDesign(design, sampleBytes, true);
                const ui = await buildPrinterFootManufacturingStl(side, false);
                const font = readFileSync(FONT);
                const headless = await buildFinalizedFootFromSavedDesign({
                    design,
                    side,
                    sampleTopBytes: sampleBytes,
                    includeLeader: false,
                    fontBytes: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
                });
                const uiLed = await buildPrinterFootManufacturingStl(side, true);
                const headLed = await buildFinalizedFootFromSavedDesign({
                    design,
                    side,
                    sampleTopBytes: sampleBytes,
                    includeLeader: true,
                    fontBytes: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
                });
                parity[label] = {
                    ui: sha256(payload(ui.stl)),
                    headless: sha256(payload(headless.stl)),
                    leaderUi: headless.uploadTriangles > 0 ? uiLed.byteLength : 0,
                    leaderHead: headLed.byteLength,
                };
                check(
                    sha256(payload(ui.stl)) === sha256(payload(headless.stl)),
                    `${label} headless no-leader != UI`,
                );
                check(
                    sha256(Buffer.from(ui.stl)) === sha256(Buffer.from(headless.stl)),
                    `${label} headless STL bytes != UI`,
                );
                check(headless.uploadTriangles > 1000, `${label} headless STL empty`);
                check(
                    sha256(payload(uiLed.stl)) === sha256(payload(headLed.stl)),
                    `${label} headless leader != UI`,
                );
                check(headLed.uploadTriangles > headLed.solidTriangles, `${label} headless leader missing`);
                const headGeom = binaryStlToGeometry(headless.stl);
                try {
                    const headReport = validateManifold(headGeom);
                    check(
                        headReport.isWatertight && headReport.eulerCharacteristic === 2,
                        `${label} headless not a closed solid`,
                    );
                    check(
                        headReport.openEdges === 0 && headReport.nonManifoldEdges === 0,
                        `${label} headless edges`,
                    );
                } finally {
                    headGeom.dispose();
                }
            }
        }
        for (const side of ["left", "right"] as const) {
            const sulcus = short[`sulcus ${side}`];
            const met = short[`met_head ${side}`];
            if (!sulcus || !met) throw new Error(`missing ${side} short-trim solid`);
            check(
                sulcus.shape.lengthMm >= met.shape.lengthMm + MIN_SULCUS_LONGER_MM,
                `${side} sulcus ${sulcus.shape.lengthMm.toFixed(1)} is not longer than met-head ${met.shape.lengthMm.toFixed(1)}`,
            );
        }

        const metrics = {
            parent,
            mainTip,
            mainMatchesParentPayload: (["left", "right"] as const).every(
                (side) => mainBase.out[side].payloadSha === parentBase.out[side].payloadSha,
            ),
            mainMatchesPrPayload: (["left", "right"] as const).every(
                (side) => mainBase.out[side].payloadSha === full[side].payloadSha,
            ),
            full: Object.fromEntries(
                (["left", "right"] as const).map((side) => [
                    side,
                    {
                        payloadSha: full[side].payloadSha,
                        triangles: full[side].solidTriangles,
                        lengthMm: Number(full[side].shape.lengthMm.toFixed(2)),
                        heelCupMm: Number(full[side].shape.heelCupMm.toFixed(2)),
                        parentPayload: parentBase.out[side].payloadSha,
                        mainPayload: mainBase.out[side].payloadSha,
                    },
                ]),
            ),
            short: Object.fromEntries(
                Object.entries(short).map(([label, solid]) => [
                    label,
                    {
                        lengthMm: Number(solid.shape.lengthMm.toFixed(2)),
                        reduction: Number(
                            (
                                1 -
                                solid.shape.lengthMm /
                                    full[label.endsWith("left") ? "left" : "right"].shape.lengthMm
                            ).toFixed(4),
                        ),
                        medialLeadMm: Number(solid.shape.medialLeadMm.toFixed(2)),
                        heelCupMm: Number(solid.shape.heelCupMm.toFixed(2)),
                        minZ: Number(solid.shape.minZ.toFixed(4)),
                        volumeMm3: Number(solid.shape.signedVolumeMm3.toFixed(0)),
                        degenerate: solid.shape.degenerate,
                        chi: solid.manifold.eulerCharacteristic,
                        openEdges: solid.manifold.openEdges,
                        nonManifoldEdges: solid.manifold.nonManifoldEdges,
                        watertight: solid.manifold.isWatertight,
                        engraved: solid.engraved,
                        triangles: solid.solidTriangles,
                    },
                ]),
            ),
            parity,
            failures,
        };
        writeFileSync("/tmp/pr497-grader-metrics.json", JSON.stringify(metrics, null, 2));
        console.log(`[PR497-GRADER]\n${JSON.stringify(metrics, null, 2)}`);
        expect(failures, failures.join("\n")).toEqual([]);
    }, 900_000);
});
