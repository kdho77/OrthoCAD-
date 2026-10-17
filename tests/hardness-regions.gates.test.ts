// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";
import JSZip from "jszip";
import * as THREE from "three";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { collectHardnessRegions } from "@/lib/hardness/collect";
import { packHardness3mf, readDesignFrom3mf } from "@/lib/hardness/export-3mf";
import {
    FIXTURE_GCODE,
    fixtureFreehandAndAbutting,
    fixturePhaseBLegacy,
    fixtureSampleTopElements,
    fixtureThreeWayOverlap,
} from "@/lib/hardness/fixtures";
import { verifyGcodeByClass } from "@/lib/hardness/gcode-verify";
import { canonicalizeJson, sha256Utf8 } from "@/lib/hardness/hash";
import { boxMesh, meshIsWatertight, meshSha, meshVolume, parseBinaryStl } from "@/lib/hardness/mesh";
import { buildRawModifiers, exportHardness3mf, samplerForDesign } from "@/lib/hardness/pipeline";
import { resolveModifiers } from "@/lib/hardness/resolve";
import {
    gateCoplanarFaces,
    gateCoverage,
    gateModifiersManifold,
    gateOvershootAndDepth,
    gatePairwiseIntersection,
    gatePriorityVoxel,
} from "@/lib/hardness/validate";
import {
    HARDNESS_CLASS_TABLE,
    REGION_HARDNESS_CLASSES,
} from "../vertex/shared/print-recipe/hardness-class-table";
import { migrateHardnessZones } from "../vertex/shared/print-recipe/hardness-region";
import { migratePrintRecipe, printRecipeV1Schema } from "../vertex/shared/print-recipe/print-recipe";

describe("hardness class table", () => {
    test("JSON table is the single calibration source", () => {
        const jsonPath = join(
            dirname(fileURLToPath(import.meta.url)),
            "../vertex/shared/print-recipe/hardness-class-table.json",
        );
        const json = JSON.parse(readFileSync(jsonPath, "utf8"));
        expect(HARDNESS_CLASS_TABLE).toEqual(json);
        expect(HARDNESS_CLASS_TABLE.Soft.sparseInfillDensityPct).toBe(11);
        expect(HARDNESS_CLASS_TABLE.Medium.sparseInfillDensityPct).toBe(22);
        expect(HARDNESS_CLASS_TABLE.Firm.sparseInfillDensityPct).toBe(38);
        expect(HARDNESS_CLASS_TABLE.Rigid.sparseInfillDensityPct).toBe(65);
        expect(HARDNESS_CLASS_TABLE.Soft.sparseInfillSpeedMmS).toBe(44.0);
        expect(HARDNESS_CLASS_TABLE.Medium.sparseInfillSpeedMmS).toBe(44.5);
        expect(HARDNESS_CLASS_TABLE.Firm.sparseInfillSpeedMmS).toBe(45.0);
        expect(HARDNESS_CLASS_TABLE.Rigid.sparseInfillSpeedMmS).toBe(45.5);
        expect(HARDNESS_CLASS_TABLE.Custom.sparseInfillDensityPctMin).toBe(5);
        expect(HARDNESS_CLASS_TABLE.Custom.sparseInfillDensityPctMax).toBe(100);
        for (const k of REGION_HARDNESS_CLASSES) {
            if (k === "Custom") continue;
            expect(HARDNESS_CLASS_TABLE[k].sparseInfillPattern).toBe("gyroid");
        }
    });
});

describe("Phase B zone migration (gate 11)", () => {
    test("empty zones round-trip identically", () => {
        const legacy = {
            version: 1 as const,
            pattern: "gyroid" as const,
            defaultHardness: "Soft" as const,
            zones: [] as [],
        };
        const m = migratePrintRecipe(legacy);
        expect(m.zones).toEqual([]);
        expect(printRecipeV1Schema.parse(m).zones).toEqual([]);
        expect(fixturePhaseBLegacy().printRecipe?.zones).toEqual([]);
    });

    test("2D MaterialZone tags become kind zone priority 0 full depth", () => {
        const migrated = migrateHardnessZones([
            {
                zone_id: "z1",
                name: "heel",
                boundary_spline: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                ],
                infill_pct: 22,
                material_hardness: "Medium",
                side: "left",
            },
        ]);
        expect(migrated).toHaveLength(1);
        expect(migrated[0]!.kind).toBe("zone");
        expect(migrated[0]!.priority).toBe(0);
        expect(migrated[0]!.depth).toEqual({ type: "full" });
    });
});

describe("element hardness persistence (gate 9 setup)", () => {
    test("placed elements keep id + hardness after JSON reopen", () => {
        const d = fixtureSampleTopElements();
        const json = canonicalizeJson(d);
        const reopened = JSON.parse(json) as typeof d;
        expect(reopened.elements.map((e) => e.id).sort()).toEqual(d.elements.map((e) => e.id).sort());
        const met = reopened.elements.find((e) => e.id === "el-met-left")!;
        expect(met.hardnessClass).toBe("Soft");
        expect(met.priority).toBe(2);
        met.position = { ...met.position, x: met.position.x + 4 };
        expect(met.hardnessClass).toBe("Soft");
        expect(met.id).toBe("el-met-left");
        const other = reopened.elements.find((e) => e.id === "el-dancer-left")!;
        expect(other.position.x).toBe(d.elements.find((e) => e.id === "el-dancer-left")!.position.x);
    });
});

describe("gcode class fingerprint (gate 13 helper)", () => {
    test("maps F mm/min to Soft/Medium/Firm/Rigid and rejects solid-in-Soft", () => {
        const ok = verifyGcodeByClass(FIXTURE_GCODE, ["Soft", "Medium", "Firm", "Rigid"]);
        expect(ok.ok).toBe(true);
        expect(ok.classesSeen.sort()).toEqual(["Firm", "Medium", "Rigid", "Soft"]);
        const bad = verifyGcodeByClass(`${FIXTURE_GCODE};TYPE:Internal solid infill\nG1 X1 Y1 E1 F2640\n`, [
            "Soft",
        ]);
        expect(bad.ok).toBe(false);
        expect(bad.errors.some((e) => /solid infill in Soft/i.test(e))).toBe(true);
    });

    test("fails when a required class has no sparse segments", () => {
        const r = verifyGcodeByClass(";TYPE:Sparse infill\nG1 X0 Y0 E0.1 F2640\n", ["Soft", "Rigid"]);
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => /Rigid/.test(e))).toBe(true);
    });
});

describe("3MF + geometry gates", () => {
    test("manifold-3d subtract: higher priority wins, equal-priority softer wins", async () => {
        const region = (
            regionId: string,
            hardnessClass: "Soft" | "Medium" | "Firm" | "Rigid",
            priority: number,
        ) => ({
            regionId,
            kind: "zone" as const,
            hardnessClass,
            priority,
            depth: { type: "full" as const },
            side: "left" as const,
            polygon: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
            ],
        });
        const fp = [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 10 },
            { x: 0, y: 10 },
        ];
        const raw = [
            {
                region: region("low-soft", "Soft", 1),
                mesh: boxMesh(0, 0, 0, 12, 10, 8),
                footprint: fp,
                volumeMm3: 12 * 10 * 8,
            },
            {
                region: region("high-firm", "Firm", 2),
                mesh: boxMesh(6, 0, 0, 18, 10, 8),
                footprint: fp,
                volumeMm3: 12 * 10 * 8,
            },
        ];
        const resolved = await resolveModifiers(raw);
        const pair = await gatePairwiseIntersection(resolved);
        expect(pair.ok).toBe(true);
        const firm = resolved.find((m) => m.region.regionId === "high-firm")!;
        const soft = resolved.find((m) => m.region.regionId === "low-soft")!;
        expect(firm.status).toBe("present");
        expect(soft.status).toBe("present");
        expect(meshVolume(firm.mesh)).toBeGreaterThan(meshVolume(soft.mesh) * 0.5);
    }, 20_000);

    test("gate 1: packing 3MF does not mutate the shell mesh", async () => {
        const shell = boxMesh(0, -40, -0.5, 260, 40, 8);
        const sha = meshSha(shell);
        const d = fixturePhaseBLegacy();
        const packed = await packHardness3mf({ design: d, side: "left", shell, modifiers: [] });
        expect(meshSha(shell)).toBe(sha);
        expect(packed.bytes.byteLength).toBeGreaterThan(100);
        const geom = new THREE.BoxGeometry(10, 10, 4);
        const stlA = geometryToBinarySTL(geom);
        const stlB = geometryToBinarySTL(geom);
        expect(new Uint8Array(stlA)).toEqual(new Uint8Array(stlB));
        geom.dispose();
    });

    test("gates 2-10,12: SAMPLE_Top elements + freehand/abut + byte-identical 3MF", async () => {
        const d = fixtureFreehandAndAbutting();
        const shell = boxMesh(-5, -50, -0.6, 270, 50, 25);
        const t0 = Date.now();
        const { requested, raw } = buildRawModifiers(d, "left");
        expect(requested.length).toBeGreaterThanOrEqual(4);
        const resolved = await resolveModifiers(raw);
        const resolveMs = Date.now() - t0;
        expect(resolveMs).toBeLessThan(2000);

        const man = gateModifiersManifold(resolved);
        expect(man.ok).toBe(true);

        const pair = await gatePairwiseIntersection(resolved);
        expect(pair.ok).toBe(true);
        const coplanar = gateCoplanarFaces(resolved);
        expect(coplanar.ok).toBe(true);

        const cov = gateCoverage(raw, resolved);
        expect(cov.ok).toBe(true);

        const sampler = samplerForDesign(d, "left");
        const over = gateOvershootAndDepth(resolved, (x, y) => sampler.zTop(x, y));
        expect(over.ok).toBe(true);

        const t1 = Date.now();
        const a = await exportHardness3mf({ design: d, side: "left", shell });
        const b = await exportHardness3mf({ design: d, side: "left", shell });
        expect(Date.now() - t1).toBeLessThan(10000);
        expect(a.report.ok).toBe(true);
        expect(a.bytes).toEqual(b.bytes);
        expect(a.designHash).toBe(b.designHash);

        const re = await readDesignFrom3mf(a.bytes);
        expect(re.designHash).toBe(a.designHash);
        expect(re.embeddedHash).toBe(a.designHash);

        const parsed = JSON.parse(re.designJson) as { design: typeof d };
        expect(parsed.design.elements.find((e) => e.id === "el-met-left")?.hardnessClass).toBe("Soft");

        const zip = await JSZip.loadAsync(a.bytes);
        const cfg = await zip.file("Metadata/model_settings.config")?.async("string");
        expect(cfg).toBeTruthy();
        expect(cfg).toContain('subtype="modifier_part"');
        expect(cfg).toContain("sparse_infill_pattern");
        expect(cfg).toContain("gyroid");
        expect(cfg).not.toMatch(/wall_loops|top_shell|bottom_shell/);
        expect(zip.file("Metadata/orthocad_design.json")).toBeTruthy();
        expect(zip.file("Metadata/orthocad_design.sha256")).toBeTruthy();

        const moved = structuredClone(d);
        const el = moved.elements.find((e) => e.id === "el-met-left")!;
        el.position = { ...el.position, x: el.position.x + 6 };
        const movedExport = await exportHardness3mf({ design: moved, side: "left", shell });
        const before = new Map(a.modifiers.map((m) => [m.region.regionId, m.meshSha]));
        const after = new Map(movedExport.modifiers.map((m) => [m.region.regionId, m.meshSha]));
        expect(before.get("el-met-left")).not.toBe(after.get("el-met-left"));
        expect(a.report.regions.every((r) => r.status !== "missing" && r.status !== "unmapped")).toBe(true);
        expect(collectHardnessRegions(d, "left").some((r) => r.kind === "freehand")).toBe(true);
        expect(collectHardnessRegions(d, "left").some((r) => r.kind === "zone")).toBe(true);
    }, 30_000);

    test("gate 7: 3-way priority vs voxel ref", async () => {
        const d = fixtureThreeWayOverlap();
        const { raw } = buildRawModifiers(d, "left");
        expect(raw.length).toBe(3);
        const resolved = await resolveModifiers(raw);
        const bounds = {
            min: [70, -15, -1] as [number, number, number],
            max: [130, 15, 20] as [number, number, number],
        };
        const g = gatePriorityVoxel(raw, resolved, bounds);
        expect(g.ok).toBe(true);
        const pair = await gatePairwiseIntersection(resolved);
        expect(pair.ok).toBe(true);
        for (const m of resolved) {
            if (m.status === "present") expect(meshIsWatertight(m.mesh)).toBe(true);
        }
        expect(
            meshVolume(resolved.find((m) => m.region.regionId === "tw-c")?.mesh ?? boxMesh(0, 0, 0, 1, 1, 1)),
        ).toBeGreaterThan(0);
    }, 20_000);

    test("gate 6: missing region fails export", async () => {
        const d = fixtureSampleTopElements();
        d.elements[0]!.hardnessClass = "Custom";
        d.elements[0]!.overrides = undefined;
        const shell = boxMesh(0, -40, -0.5, 260, 40, 8);
        await expect(exportHardness3mf({ design: d, side: "left", shell })).rejects.toThrow(
            /unmapped|failed/i,
        );
    });

    test("schema supports freehand without a drawing UI", () => {
        const d = fixtureFreehandAndAbutting();
        const fh = collectHardnessRegions(d, "left").filter((r) => r.kind === "freehand");
        expect(fh.length).toBe(2);
        expect(fh.some((r) => r.polygon && r.polygon.length >= 3)).toBe(true);
    });

    test("parseBinaryStl round-trips a shell", () => {
        const geom = new THREE.BoxGeometry(20, 10, 6);
        const stl = geometryToBinarySTL(geom);
        const mesh = parseBinaryStl(stl);
        expect(mesh.indices.length).toBeGreaterThan(0);
        expect(meshIsWatertight(mesh)).toBe(true);
        geom.dispose();
    });
});
