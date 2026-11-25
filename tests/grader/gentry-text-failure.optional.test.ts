// G3. Force TextMarkingError on the real belt catch. No loft: the manufacturing
// cache returns a stand-in solid, then applyTextMarkingToPrintSolid throws.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { baseModifierFieldAuthoritative, getDesignBase } from "@/lib/geometry/base-asset";
import { buildExportStl, manufacturingFingerprintForActiveExport } from "@/lib/geometry/export-geometry";
import {
    manufacturingSolidFingerprint,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
    stampManufacturingSolidFrame,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { manufacturingCacheContext } from "@/lib/geometry/procedural-wall/manufacturing-solid-context";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import { buildProceduralExportSolid } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";
import { defaultBottomTextMarking } from "../../vertex/shared/bottom-text-marking";

rs.mock("@/lib/geometry/text-marking/apply", () => ({
    applyTextMarkingToPrintSolid: async () => {
        const { TextMarkingError } = await import("@/lib/geometry/text-marking/errors");
        throw new TextMarkingError("z0", "bottom z=0.400 outside the recess");
    },
}));

function standInSolid(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array([0, 0, 0, 80, 0, 0, 0, 30, 0]), 3),
    );
    geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    const ring = [
        { x: 0, y: -20, z: 0 },
        { x: 180, y: -16, z: 0 },
        { x: 180, y: 16, z: 0 },
        { x: 0, y: 20, z: 0 },
    ];
    geometry.userData = { outlineRing: ring, bottomOutlineB: ring, wallFrames: [] };
    return geometry;
}

function markedDesign() {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.textMarking = {
        ...defaultBottomTextMarking(),
        text: "JABBOUR",
        addPatientName: false,
        feet: "both",
        mode: "engrave",
    };
    useDesignStore.setState({
        design,
        viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural" },
    });
    return design;
}

describe("G3 belt text failure", () => {
    test("beltPrint rethrows and a non-belt export records textFitError on the solid", async () => {
        const design = markedDesign();
        const side: Side = "left";
        const base = getDesignBase(design, side);
        const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
        const fieldOptions = printSolidOptions({
            design,
            side,
            field,
            viewer: { wallModel: "procedural", wallStyle: "round" },
            trimline: null,
            bottomPattern: null,
        });
        const context = manufacturingCacheContext({
            design,
            side,
            baseAssetId: base?.assetId ?? "",
            mirrored: Boolean(base?.mirrored),
        });
        const marking = design.textMarking;

        resetManufacturingSolidCache();
        const beltOptions = { ...fieldOptions, textMarking: marking, side, beltPrint: true as const };
        const beltSolid = standInSolid();
        stampManufacturingSolidFrame(beltSolid, beltOptions, context);
        rememberManufacturingSolid(manufacturingSolidFingerprint(beltOptions, context), side, beltSolid);
        await expect(buildProceduralExportSolid(beltOptions, context)).rejects.toThrow(/Refusing to upload/);
        await expect(buildProceduralExportSolid(beltOptions, context)).rejects.toThrow(/bottom z=0\.400/);

        resetManufacturingSolidCache();
        const plainOptions = { ...fieldOptions, textMarking: marking, side };
        const plainSolid = standInSolid();
        stampManufacturingSolidFrame(plainSolid, plainOptions, context);
        rememberManufacturingSolid(manufacturingSolidFingerprint(plainOptions, context), side, plainSolid);
        const plain = await buildProceduralExportSolid(plainOptions, context);
        const recorded = (plain.geometry.userData as { textFitError?: string }).textFitError ?? "";
        expect(recorded).toContain("[TEXT]");
        expect(recorded).toContain("bottom z=0.400");
        expect(recorded).not.toContain("Refusing to upload");
        plain.geometry.dispose();

        resetManufacturingSolidCache();
        const exportBelt = standInSolid();
        stampManufacturingSolidFrame(exportBelt, { beltPrint: true }, context);
        rememberManufacturingSolid(manufacturingFingerprintForActiveExport(side, true), side, exportBelt);
        await expect(buildExportStl(side, { exportMode: "manufacturing", beltPrint: true })).rejects.toThrow(
            /Refusing to upload/,
        );

        resetManufacturingSolidCache();
        const exportPlain = standInSolid();
        stampManufacturingSolidFrame(exportPlain, { beltPrint: false }, context);
        rememberManufacturingSolid(manufacturingFingerprintForActiveExport(side, false), side, exportPlain);
        try {
            await buildExportStl(side, { exportMode: "manufacturing" });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // The stand-in is not a closed solid, so Export retries a real loft and
            // then cannot fetch SAMPLE_Top. That retry only happens because the
            // text failure was recorded instead of rethrown.
            expect(message).not.toContain("Refusing to upload");
            expect(message).not.toContain("bottom z=0.400");
        }
    });
});
