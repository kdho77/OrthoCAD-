// G4 refusals through assertProductionFootStl. The accepted feet are in the belt grade.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { meshYSign } from "@/lib/geometry/handedness";
import { outlineHalfWidth } from "@/lib/geometry/height-field";
import {
    assertProductionFootStl,
    composedFootRim,
    ManufacturingFootRefusal,
} from "@/lib/geometry/procedural-wall/manufacturing-foot-guard";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState } from "@/types";
import { defaultBottomTextMarking } from "../../vertex/shared/bottom-text-marking";

const SAMPLE = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

function stlFromPoints(points: Array<{ x: number; y: number; z: number }>): ArrayBuffer {
    const buffer = new ArrayBuffer(84 + points.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, points.length, true);
    let offset = 84;
    for (const point of points) {
        offset += 12;
        for (let corner = 0; corner < 3; corner++) {
            view.setFloat32(offset, point.x, true);
            view.setFloat32(offset + 4, point.y, true);
            view.setFloat32(offset + 8, point.z, true);
            offset += 12;
        }
        offset += 2;
    }
    return buffer;
}

function quietDesign(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.shoeWidth = "medium";
    design.textMarking = { ...defaultBottomTextMarking(), text: "", addPatientName: false };
    return design;
}

describe("G4 assertProductionFootStl refusals", () => {
    test("refuses a generic last, a flipped foot, a heel-first solid, and a missing name", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE);
        const native = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        primeSampleTopGeometry(native);
        const design = quietDesign();
        const rim = await composedFootRim(native, design, "left");
        const layout = insoleLayoutFromDesign(design);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const point of rim) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
        const span = Math.max(1e-6, maxX - minX);
        const midY = (minY + maxY) / 2;
        const medial = meshYSign("left", "medial");

        const last = [];
        for (let i = 0; i <= 48; i++) {
            const u = i / 48;
            const half = outlineHalfWidth(u) * (layout.widthMm / 2);
            const x = minX + u * span;
            const z = u < 0.2 ? 22 : 4;
            last.push({ x, y: -half, z }, { x, y: half, z });
        }
        await expect(
            assertProductionFootStl({ stl: stlFromPoints(last), design, side: "left", native }),
        ).rejects.toBeInstanceOf(ManufacturingFootRefusal);
        await expect(
            assertProductionFootStl({ stl: stlFromPoints(last), design, side: "left", native }),
        ).rejects.toThrow(/not the lofted foot/);

        const flipped = rim.map((point) => {
            const u = (point.x - minX) / span;
            const onMedial = medial < 0 ? point.y < midY : point.y > midY;
            let z = 4;
            if (u < 0.2) z = 22;
            else if (u > 0.8) z = 3;
            else if (u >= 0.4 && u < 0.6) z = onMedial ? 3 : 18;
            return { x: point.x, y: point.y, z };
        });
        await expect(
            assertProductionFootStl({ stl: stlFromPoints(flipped), design, side: "left", native }),
        ).rejects.toThrow(/handedness margin/);

        const heelFirst = rim.map((point) => {
            const u = (point.x - minX) / span;
            const onMedial = medial < 0 ? point.y < midY : point.y > midY;
            const z = u > 0.8 ? 22 : u >= 0.4 && u < 0.6 && onMedial ? 16 : 4;
            return { x: point.x, y: point.y, z };
        });
        await expect(
            assertProductionFootStl({ stl: stlFromPoints(heelFirst), design, side: "left", native }),
        ).rejects.toThrow(/heel-first/);

        const unnamedDesign: DesignState = {
            ...design,
            textMarking: {
                ...defaultBottomTextMarking(),
                text: "JABBOUR",
                addPatientName: false,
                feet: "both",
            },
        };
        const unnamed = rim.map((point) => {
            const u = (point.x - minX) / span;
            const onMedial = medial < 0 ? point.y < midY : point.y > midY;
            const z = u < 0.2 ? 22 : u >= 0.4 && u < 0.6 && onMedial ? 16 : 4;
            return { x: point.x, y: point.y, z };
        });
        await expect(
            assertProductionFootStl({
                stl: stlFromPoints(unnamed),
                design: unnamedDesign,
                side: "left",
                native,
            }),
        ).rejects.toThrow(/plantar name/);
        native.dispose();
    }, 120_000);
});
