/**
 * Modified soles leave grid-collinear, pinched, or island pocket boundaries.
 * Engraving those must stay an exact manifold and must still cut the glyphs.
 * Browser Export and the headless bundle share engraveBottomPlanar.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { BufferGeometry } from "three";
import { buildExportGeometry } from "@/lib/geometry/export-geometry";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { engraveBottomPlanar } from "@/lib/geometry/text-marking/bottom-engrave";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont, primeTextFont } from "@/lib/geometry/text-marking/font";
import { extractHostTextContext, placeBottomText } from "@/lib/geometry/text-marking/place";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import type { DesignState, Side, SideCorrections } from "@/types";

function copyFileBytes(path: string): ArrayBuffer {
    const buf = readFileSync(path);
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(buf);
    return copy;
}

async function loft(design: DesignState, side: Side): Promise<BufferGeometry> {
    resetSampleTopGeometryCache();
    primeSampleTopGeometry(
        await sampleTopFromArrayBuffer(copyFileBytes(resolve("vertex/public/Templates/SAMPLE_Top.glb"))),
    );
    primeTextFont(copyFileBytes(resolve("vertex/public/fonts/Inter-Bold.ttf")));
    resetManufacturingSolidCache();
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    usePreviewLoftStatusStore.setState({ printLoftEpoch: 0 });
    useDesignStore.setState({
        design,
        viewer: {
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso",
            wallModel: "procedural",
        },
    });
    return buildExportGeometry(side);
}

function withCorr(base: DesignState, patch: Partial<SideCorrections>): DesignState {
    return {
        ...base,
        corrections: {
            ...base.corrections,
            linked: true,
            left: { ...base.corrections.left, ...patch },
            right: { ...base.corrections.right, ...patch },
        },
    };
}

async function engrave(
    host: BufferGeometry,
    side: Side,
    text: string,
    capHeightMm: number,
    placementU: number,
): Promise<BufferGeometry> {
    const font = await loadTextFont();
    const marking = {
        ...defaultTextMarking("bottom"),
        text,
        capHeightMm,
        placementU,
        bold: true,
        addPatientName: false,
    };
    const placed = placeBottomText(
        host,
        extractHostTextContext(host),
        marking,
        flattenText(font, text, capHeightMm, marking.depthMm, true),
        side,
    );
    const engraved = await engraveBottomPlanar(host, placed.flat.groups, marking.depthMm);
    const outline = engraved.userData.bottomOutlineWorld as unknown[] | undefined;
    expect(outline?.length ?? 0).toBeGreaterThan(0);
    return engraved;
}

describe("modified sole bottom engrave", () => {
    test("widened forefoot and high arch plus flexible foot stay manifold", async () => {
        const blank = createDesignWithStockPlaceholder();
        blank.textMarking = undefined;
        const wide = withCorr(blank, { forefootWidthMm: 10 });
        wide.sizeSystem = "us";
        wide.usMenSize = 7;
        wide.shoeWidth = "medium";
        wide.pattern = "full_contact";
        const high = withCorr(createDesignWithStockPlaceholder(), {
            archHeightMm: 3,
            apexMoveMm: 4,
        });
        high.textMarking = undefined;
        high.pattern = "full_contact";

        const wideHost = await loft(wide, "right");
        const highHost = await loft(high, "left");
        const engraved = [
            await engrave(wideHost, "right", "JABBOUR", 12, 0.32),
            await engrave(wideHost, "right", "NOEMI GUTIERREZ", 6, 0.32),
            await engrave(highHost, "left", "O", 12, 0.18),
            await engrave(highHost, "left", "NOEMI GUTIERREZ", 6, 0.32),
        ];
        for (const geo of engraved) geo.dispose();
        wideHost.dispose();
        highHost.dispose();
    }, 180_000);
});
