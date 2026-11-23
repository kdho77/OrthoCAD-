import { afterEach, describe, expect, test } from "@rstest/core";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import type { PlacedElement } from "@/types";
import {
    HARDNESS_CLASS_TABLE,
    NAMED_HARDNESS_CLASSES,
} from "../../vertex/shared/print-recipe/hardness-class-table";
import {
    addedProductFiles,
    CAD_OPERATOR_BELT_MATERIAL,
    CAD_OPERATOR_BELT_PROFILE_ID,
    captureProductionForm,
    classRow,
    coverFootprint,
    deviceInfillPct,
    diffAddedLines,
    elementOn,
    envelopeOf,
    footprintMeshY,
    liveSlicerConfigured,
    loadSavedDesign,
    productDiffNames,
    readBaseline,
    regionalPack,
    regionDensity,
    SAMPLE_TOP_ASSET_ID,
    SAMPLE_TOP_GLB_PATH,
    sampleTopFacts,
    sha256,
    standInShell,
    textMarkingFacts,
} from "./harness";
import {
    CLASS_LADDER,
    DEVICE_MEDIUM_INFILL,
    FOOTPRINT_AABB_PAD_MM,
    FOOTPRINT_COVERAGE_MIN,
    FORBIDDEN_DIFF,
    FORBIDDEN_FORM_KEY,
    FORM_KEYS,
    HEEL_CLEARANCE_MM,
    MATERIAL_ID,
    MET_MIN_CELLS,
    MODIFIER_META_KEYS,
    MORTONS_MIN_CELLS,
    NAMED_CLASSES,
    PROFILE_ID,
    SHELL_META_KEYS,
} from "./thresholds";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function withHardness(el: PlacedElement, hardnessClass: PlacedElement["hardnessClass"]): PlacedElement {
    return {
        ...el,
        regionId: el.id,
        hardnessClass,
        priority: 1,
        depth: { type: "element", depthBelowMm: 2 },
    };
}

describe("mortons extra hard gates", () => {
    test("pass-on-base TABLE-EXTRA-HARD locked ladder", () => {
        expect([...NAMED_HARDNESS_CLASSES]).toEqual([...NAMED_CLASSES]);
        expect(Object.keys(HARDNESS_CLASS_TABLE).sort()).toEqual([...NAMED_CLASSES, "Custom"].sort());
        for (const name of NAMED_CLASSES) {
            const measured = classRow(name);
            const threshold = CLASS_LADDER[name];
            expect(
                measured.densityPct,
                `${name} density measured ${measured.densityPct} threshold ${threshold.densityPct}`,
            ).toBe(threshold.densityPct);
            expect(measured.lineWidthMm, `${name} line width measured ${measured.lineWidthMm}`).toBe(
                threshold.lineWidthMm,
            );
            expect(measured.speedMmS, `${name} speed measured ${measured.speedMmS}`).toBe(threshold.speedMmS);
            expect(measured.pattern).toBe(threshold.pattern);
        }
        expect(CAD_OPERATOR_BELT_PROFILE_ID).toBe(PROFILE_ID);
        expect(CAD_OPERATOR_BELT_MATERIAL).toBe(MATERIAL_ID);
    });

    test("pass-on-base T1-EXPLICIT-CLASS stays the class already stored", () => {
        const design = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
        const el = elementOn(design, "mortons_extension", "left");
        expect(el.hardnessClass).toBeUndefined();
        design.elements = [withHardness(el, "Hard")];
        const hardEl = design.elements[0];
        if (!hardEl) throw new Error("explicit Hard element missing");
        const hard = regionDensity(design, hardEl);
        expect(hard.count, "explicit Hard region count").toBe(1);
        expect(hard.hardnessClass).toBe("Hard");
        expect(hard.densityPct).toBe(CLASS_LADDER.Hard.densityPct);
        design.elements = [withHardness(el, "Extra Hard")];
        const extraEl = design.elements[0];
        if (!extraEl) throw new Error("explicit Extra Hard element missing");
        const extra = regionDensity(design, extraEl);
        expect(extra.hardnessClass).toBe("Extra Hard");
        expect(extra.densityPct).toBe(38);
        expect(extra.lineWidthMm).toBe(1);
        expect(extra.pattern).toBe("gyroid");
    });

    test("pass-on-base T1-REVERSE unset does not become Extra Hard", () => {
        const design = loadSavedDesign({ elements: [{ name: "reverse_mortons", side: "left" }] });
        const el = elementOn(design, "reverse_mortons", "left");
        const measured = regionDensity(design, el);
        expect(measured.count, "reverse unset region count measured").toBe(0);
        expect(measured.hardnessClass).not.toBe("Extra Hard");
    });

    test("pass-on-base T1-MET-UNSET is not given a hardness region", () => {
        const design = loadSavedDesign({ elements: [{ name: "met_pad", side: "left" }] });
        const measured = regionDensity(design, elementOn(design, "met_pad", "left"));
        expect(measured.count, "met pad unset region count measured").toBe(0);
    });

    test("pass-on-base FOOTPRINT-MEDIAL-SIGN left and right Morton's planforms face each other", () => {
        const design = loadSavedDesign({
            elements: [
                { name: "mortons_extension", side: "left" },
                { name: "mortons_extension", side: "right" },
            ],
        });
        const left = footprintMeshY(design, elementOn(design, "mortons_extension", "left"));
        const right = footprintMeshY(design, elementOn(design, "mortons_extension", "right"));
        expect(
            left.cells,
            `left footprint cells measured ${left.cells} threshold ${MORTONS_MIN_CELLS}`,
        ).toBeGreaterThanOrEqual(MORTONS_MIN_CELLS);
        expect(right.cells, `right footprint cells measured ${right.cells}`).toBeGreaterThanOrEqual(
            MORTONS_MIN_CELLS,
        );
        expect(left.centroidY, `left centroid Y measured ${left.centroidY}`).toBeLessThan(0);
        expect(right.centroidY, `right centroid Y measured ${right.centroidY}`).toBeGreaterThan(0);
        expect(left.minX, `left footprint min X measured ${left.minX}`).toBeGreaterThan(
            HEEL_CLEARANCE_MM + 12,
        );
    });

    test("pass-on-base MET-MODIFIER-KEYS existing Soft met pad stays inside the modifier contract", async () => {
        const design = loadSavedDesign({ elements: [{ name: "met_pad", side: "left" }] });
        const el = elementOn(design, "met_pad", "left");
        design.splitElements = true;
        design.elements = [withHardness(el, "Soft")];
        const pack = await regionalPack(design, "left", standInShell());
        expect(pack.threw, pack.error).toBe(false);
        expect(pack.modifiers, "met modifier count").toHaveLength(1);
        const mod = pack.modifiers[0];
        if (!mod) throw new Error("met modifier missing");
        expect(mod.density).toBe("20%");
        expect(mod.pattern).toBe("gyroid");
        expect(mod.lineWidth).toBe("0.7");
        expect([...mod.metaKeys].sort()).toEqual([...MODIFIER_META_KEYS]);
        expect(Object.keys(pack.shellMeta).sort()).toEqual([...SHELL_META_KEYS]);
        expect(pack.shellMeta.slow_down_layer_time).toBe("0");
        const placed = design.elements[0];
        if (!placed) throw new Error("met element missing");
        const foot = footprintMeshY(design, placed);
        expect(
            foot.cells,
            `met footprint cells measured ${foot.cells} threshold ${MET_MIN_CELLS}`,
        ).toBeGreaterThanOrEqual(MET_MIN_CELLS);
    });

    test("pass-on-base UPLOAD-EQUALS-STL when the saved design has no effective regions", async () => {
        const design = loadSavedDesign({});
        const shell = standInShell();
        const pack = await regionalPack(design, "left", shell);
        expect(pack.threw, pack.error).toBe(false);
        expect(pack.contentType).toBe("model/stl");
        expect(pack.filename).toBe("left.stl");
        expect(pack.uploadEqualsStl, "upload sha equals stl sha").toBe(true);
        expect(pack.modelSha256).toBe(sha256(new Uint8Array(shell)));
        expect(pack.modifiers).toHaveLength(0);
    });

    test("pass-on-base FORM-KEYS device infill and no surface overrides", async () => {
        const design = loadSavedDesign({});
        const infill = deviceInfillPct(design);
        expect(String(infill), `device infill measured ${infill} threshold ${DEVICE_MEDIUM_INFILL}`).toBe(
            DEVICE_MEDIUM_INFILL,
        );
        const shell = new Uint8Array(standInShell());
        const form = await captureProductionForm({
            model: shell,
            filename: "left.stl",
            infillDensityPct: infill,
        });
        expect(form.keys, `form keys measured ${form.keys.join(",")}`).toEqual([...FORM_KEYS]);
        expect(form.fields.profile_id).toBe(PROFILE_ID);
        expect(form.fields.material).toBe(MATERIAL_ID);
        expect(form.fields.infill_density).toBe(DEVICE_MEDIUM_INFILL);
        expect(form.loggedModel, `logged model name measured ${form.loggedModel}`).toBe("left.stl");
        for (const key of form.keys) expect(key).not.toMatch(FORBIDDEN_FORM_KEY);
        expect(form.liveSlicerConfigured, "VERTEXSLICE_SLICER_URL set at process start").toBe(false);
        expect(liveSlicerConfigured()).toBe(false);
    });

    test("pass-on-base REGIONAL-FLAG-OFF stays the STL", async () => {
        const { buildRegional3mfFromSavedSettings } = await import(
            "@/features/exports/saved-design-finalized-mesh"
        );
        const { selectVertexSliceUpload } = await import("../../vertex/shared/vertexslice-regional-3mf");
        const design = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
        const shell = standInShell();
        const enabled = false;
        const regional = enabled
            ? await buildRegional3mfFromSavedSettings({
                  settingsJson: envelopeOf(design),
                  side: "left",
                  manufacturingStl: shell,
              })
            : null;
        const upload = selectVertexSliceUpload({
            stl: new Uint8Array(shell),
            stlFilename: "left.stl",
            regional3mf: regional,
            regional3mfEnabled: enabled,
        });
        expect(upload.contentType).toBe("model/stl");
        expect(sha256(upload.bytes)).toBe(sha256(new Uint8Array(shell)));
    });

    test("pass-on-base R4-SAMPLE-TOP the saved design starts from SAMPLE_Top", () => {
        const design = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
        const facts = sampleTopFacts(design);
        expect(facts.assetId).toBe(SAMPLE_TOP_ASSET_ID);
        expect(facts.assetId).toBe("sample-top");
        expect(facts.glbPath).toBe(SAMPLE_TOP_GLB_PATH);
        expect(facts.glbPath).toBe("Templates/SAMPLE_Top.glb");
    });

    test("pass-on-base R5-TEXT bottom engrave via textMarking", () => {
        const design = loadSavedDesign({});
        const facts = textMarkingFacts(design);
        expect(facts.surface).toBe("bottom");
        expect(facts.mode).toBe("engrave");
        expect(design.textMarking?.text ?? "").toBe("");
        const baseline = readBaseline();
        expect(facts.sha256, "textMarking sha").toBe(baseline.textMarkingSha256);
    });

    test("pass-on-base R1-R2-R3-R6 diff does not touch surface, seams, secrets, or a new builder", () => {
        const names = productDiffNames();
        const added = addedProductFiles();
        const forbidden = names.filter((name) => FORBIDDEN_DIFF.some((re) => re.test(name)));
        expect(forbidden, `forbidden paths measured ${forbidden.join(" ") || "(none)"}`).toEqual([]);
        const classTable = names.filter((name) => name.includes("hardness-class-table"));
        expect(classTable, "hardness class table files in the diff").toEqual([]);
        const newProduct = added.filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"));
        expect(newProduct, `new product files measured ${newProduct.join(" ") || "(none)"}`).toEqual([]);
        const secretLines = diffAddedLines().filter((line) => /(api[_-]?key|bearer)\s*[:=]/i.test(line));
        expect(secretLines.length, "secret-like added lines").toBe(0);
    });

    test("pass-on-base MM-EXPLICIT-SPLIT-ON matches the frozen base slice outcome", async () => {
        const design = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
        const el = elementOn(design, "mortons_extension", "left");
        design.splitElements = true;
        design.elements = [withHardness(el, "Hard")];
        const pack = await regionalPack(design, "left", standInShell());
        const baseline = readBaseline();
        expect(pack.threw, `threw measured ${pack.threw} error ${pack.error}`).toBe(
            baseline.explicitSplitOnThrew,
        );
        expect(pack.error).toBe(baseline.explicitSplitOnError);
        expect(pack.modelSha256).toBe(baseline.explicitSplitOnModelSha256);
    });

    test("pass-on-base MM-EXPLICIT-SPLIT-OFF stays a byte-identical STL upload", async () => {
        const design = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
        const el = elementOn(design, "mortons_extension", "left");
        design.elements = [withHardness(el, "Hard")];
        const pack = await regionalPack(design, "left", standInShell());
        const baseline = readBaseline();
        expect(pack.threw, pack.error).toBe(false);
        expect(pack.contentType).toBe("model/stl");
        expect(pack.uploadEqualsStl).toBe(true);
        expect(pack.modelSha256).toBe(baseline.explicitSplitOffModelSha256);
        const form = await captureProductionForm({
            model: pack.bytes ?? new Uint8Array(),
            filename: pack.filename,
            infillDensityPct: deviceInfillPct(design),
        });
        expect(form.fields.infill_density).toBe(DEVICE_MEDIUM_INFILL);
        expect(form.keys).toEqual([...FORM_KEYS]);
    });

    test("defect-on-base T1-COLLECT unset Morton's is Extra Hard 38% gyroid 1.0 mm", () => {
        const design = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
        const el = elementOn(design, "mortons_extension", "left");
        expect(el.hardnessClass, "stored hardnessClass").toBeUndefined();
        const measured = regionDensity(design, el);
        expect(measured.count, `element regions measured ${measured.count} threshold 1`).toBe(1);
        expect(measured.hardnessClass, `class measured ${measured.hardnessClass}`).toBe("Extra Hard");
        expect(measured.densityPct, `density measured ${measured.densityPct} threshold 38`).toBe(38);
        expect(measured.pattern).toBe("gyroid");
        expect(measured.lineWidthMm, `line width measured ${measured.lineWidthMm} threshold 1.0`).toBe(1);
        expect(measured.speedMmS, `speed measured ${measured.speedMmS} threshold 45.5`).toBe(45.5);
    });

    test("defect-on-base T2-SAVED-DESIGN production slice carries a 38% modifier on the Morton's footprint", async () => {
        const design = loadSavedDesign({ elements: [{ name: "mortons_extension", side: "left" }] });
        const el = elementOn(design, "mortons_extension", "left");
        expect(design.splitElements).not.toBe(true);
        const pack = await regionalPack(design, "left", standInShell());
        expect(pack.threw, `slice pack error ${pack.error}`).toBe(false);
        expect(pack.regionCount, `modifier count measured ${pack.regionCount} threshold 1`).toBe(1);
        expect(pack.modifiers).toHaveLength(1);
        const mod = pack.modifiers[0];
        if (!mod) throw new Error("Morton's modifier missing");
        expect(mod.density, `sparse_infill_density measured ${mod.density} threshold 38%`).toBe("38%");
        expect(mod.pattern).toBe("gyroid");
        expect(mod.lineWidth, `line width measured ${mod.lineWidth} threshold 1.0`).toBe("1.0");
        expect(mod.speed, `speed measured ${mod.speed} threshold 45.5`).toBe("45.5");
        expect(mod.hardnessClass).toBe("Extra Hard");
        expect(mod.name).toBe("mortons_extension");
        expect([...mod.metaKeys].sort()).toEqual([...MODIFIER_META_KEYS]);
        const foot = footprintMeshY(design, el);
        const coverage = coverFootprint(foot, mod.mesh);
        expect(
            coverage.cellCoverage,
            `footprint coverage measured ${coverage.cellCoverage} threshold ${FOOTPRINT_COVERAGE_MIN}`,
        ).toBeGreaterThanOrEqual(FOOTPRINT_COVERAGE_MIN);
        expect(
            coverage.modifierMinX,
            `modifier min X ${coverage.modifierMinX} footprint min X ${foot.minX}`,
        ).toBeGreaterThanOrEqual(foot.minX - FOOTPRINT_AABB_PAD_MM);
        expect(
            coverage.modifierMaxX,
            `modifier max X ${coverage.modifierMaxX} footprint max X ${foot.maxX}`,
        ).toBeLessThanOrEqual(foot.maxX + FOOTPRINT_AABB_PAD_MM);
        expect(
            coverage.modifierMinY,
            `modifier min Y ${coverage.modifierMinY} footprint min Y ${foot.minY}`,
        ).toBeGreaterThanOrEqual(foot.minY - FOOTPRINT_AABB_PAD_MM);
        expect(
            coverage.modifierMaxY,
            `modifier max Y ${coverage.modifierMaxY} footprint max Y ${foot.maxY}`,
        ).toBeLessThanOrEqual(foot.maxY + FOOTPRINT_AABB_PAD_MM);
        expect(
            coverage.heelClearanceMm,
            `heel clearance measured ${coverage.heelClearanceMm} mm threshold ${HEEL_CLEARANCE_MM}`,
        ).toBeGreaterThanOrEqual(HEEL_CLEARANCE_MM);
        expect(
            Math.abs(coverage.centroidDeltaY),
            `centroid delta Y measured ${coverage.centroidDeltaY}`,
        ).toBeLessThanOrEqual(8);
        const infill = deviceInfillPct(design);
        expect(String(infill)).toBe(DEVICE_MEDIUM_INFILL);
        const form = await captureProductionForm({
            model: pack.bytes ?? new Uint8Array(),
            filename: pack.filename,
            infillDensityPct: infill,
            expectedRegionCount: pack.regionCount,
        });
        expect(form.keys).toEqual([...FORM_KEYS]);
        expect(form.fields.infill_density).toBe(DEVICE_MEDIUM_INFILL);
        expect(form.loggedModel, `logged model name measured ${form.loggedModel}`).toBe("model.3mf");
        expect(form.liveSlicerConfigured, "G-code was not sliced; slicer URL unset").toBe(false);
    });

    test("defect-on-base ONE-ADD-WHILE-SPLIT a Morton's added with split already on resolves to Extra Hard", () => {
        localStorage.removeItem("vertex-design-session");
        useClinicalWorkflowStore.setState({ elementPlacementFoot: "both" });
        const stock = loadSavedDesign({});
        stock.splitElements = true;
        useDesignStore.setState({
            design: stock,
            pendingSessionDesign: null,
            selectedElementId: null,
            history: [],
            future: [],
        });
        useDesignStore.getState().addElement("mortons_extension", "left");
        const design = useDesignStore.getState().design;
        const el = elementOn(design, "mortons_extension", "left");
        const measured = regionDensity(design, el);
        expect(
            measured.hardnessClass,
            `class measured ${measured.hardnessClass || el.hardnessClass || "(none)"}`,
        ).toBe("Extra Hard");
        expect(measured.densityPct, `density measured ${measured.densityPct} threshold 38`).toBe(38);
        expect(measured.lineWidthMm).toBe(1);
        expect(measured.pattern).toBe("gyroid");
    });
});
