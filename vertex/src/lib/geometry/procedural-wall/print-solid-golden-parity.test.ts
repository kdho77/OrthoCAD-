// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// The Print-tab solid for both feet must match the mesh main produced before
// the parallel-loft / cache / cap / spline speedups: same vertex bytes, same
// index bytes, same order. Station spacing is unchanged.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    primeSampleTopGeometry,
    reconstructProceduralPreview,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { DesignState, ElementKind, PlacedElement, Side } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

/**
 * SHA-256 of the position buffer then the index buffer, captured on main
 * before this speedup. Vertex order and triangle order are part of the hash.
 */
const MAIN_SOLID_SHA256: Record<string, string> = {
    "default-round-left": "e85ed678b36ef4d233c293026e292d911e8d37b080e0c47457a9c926a9b32f71",
    "default-round-right": "c458d78e20bf093461624bc2591df3408addf5d48454eb7cb141d790ec20a98f",
    "elements-round-left": "0f71004dfb1ccca437be77f40ec9a5a1b953f27dc682824570da74e92c6c7b02",
    "elements-round-right": "d840396743d613eaffd50ec5dc8ff4c6f5f45090ae2d296af624c20a80b28fd7",
    "default-straight-left": "4f443ea8b859869251e7336a8621037bd1d4206030bee836291acad4a218e063",
    "default-straight-right": "c46ec1bd999c0a82ac01470453855be588d39f46bda605bed94b06d2ec990202",
    "default-hybrid-left": "2ae639716c65cbc49f087466f3fb1bc9b3fa60073cdf80bc7caf1a020a344e98",
    "default-hybrid-right": "4334f6c2ba149922bcc2f8a9d75e393a72caa355b7fd2cdf4943f12c24329eda",
};

function meshSha256(geo: BufferGeometry): string {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos) throw new Error("print solid has no positions");
    const positions = pos.array as Float32Array;
    const hash = createHash("sha256");
    hash.update(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
    if (index) {
        const indices = index.array as Uint16Array | Uint32Array;
        hash.update(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength));
    }
    hash.update(`v=${positions.length};i=${index ? index.array.length : 0}`);
    return hash.digest("hex");
}

function installDesign(design: DesignState): void {
    useDesignStore.setState({
        design,
        viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "functional" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

function withHeelAndElements(base: DesignState): DesignState {
    const layout = insoleLayoutFromDesign(base);
    const place = (kind: ElementKind, side: Side): PlacedElement => ({
        id: `${kind}-${side}`,
        kind,
        side,
        ...defaultElementPose(kind, side, layout.lengthMm, layout.widthMm),
    });
    return {
        ...base,
        corrections: {
            ...base.corrections,
            left: { ...base.corrections.left, heelLiftMm: 6 },
            right: { ...base.corrections.right, heelLiftMm: 6 },
        },
        elements: [
            place("met_pad", "left"),
            place("mortons_extension", "left"),
            place("met_pad", "right"),
            place("mortons_extension", "right"),
        ],
    };
}

describe("print solid matches main byte for byte", () => {
    test("default Men's 9, met pad + Morton's + 6 mm heel lift, and round/straight/hybrid walls", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const native = await sampleTopFromArrayBuffer(buf);
        primeSampleTopGeometry(native.clone());

        const stock = createDesignWithStockPlaceholder();
        installDesign(stock);
        const decorated = withHeelAndElements(stock);
        const { getDesignBase } = await import("@/lib/geometry/base-asset");

        async function solidFor(
            design: DesignState,
            side: Side,
            wallStyle: "round" | "straight" | "hybrid",
        ): Promise<BufferGeometry> {
            const base = getDesignBase(design, side);
            let raw = native.clone();
            if (base?.mirrored) {
                const mirrored = mirrorGeometry(raw);
                raw.dispose();
                raw = mirrored;
            }
            const thickness = design.paired
                ? side === "left"
                    ? design.paired.leftThicknessMm
                    : design.paired.rightThicknessMm
                : design.thicknessMm;
            const field = baseModifierField(design, side, thickness);
            const options = printSolidOptions({
                design,
                side,
                field,
                viewer: { wallModel: "procedural", wallStyle, deviceType: "functional" },
                trimline: null,
                bottomPattern: null,
            });
            const preview = await reconstructProceduralPreview(raw, options);
            raw.dispose();
            return preview.geometry;
        }

        const cases: Array<{
            key: string;
            design: DesignState;
            side: Side;
            wallStyle: "round" | "straight" | "hybrid";
        }> = [
            { key: "default-round-left", design: stock, side: "left", wallStyle: "round" },
            { key: "default-round-right", design: stock, side: "right", wallStyle: "round" },
            { key: "elements-round-left", design: decorated, side: "left", wallStyle: "round" },
            { key: "elements-round-right", design: decorated, side: "right", wallStyle: "round" },
            { key: "default-straight-left", design: stock, side: "left", wallStyle: "straight" },
            { key: "default-straight-right", design: stock, side: "right", wallStyle: "straight" },
            { key: "default-hybrid-left", design: stock, side: "left", wallStyle: "hybrid" },
            { key: "default-hybrid-right", design: stock, side: "right", wallStyle: "hybrid" },
        ];

        const recorded: Record<string, string> = {};
        for (const item of cases) {
            const geometry = await solidFor(item.design, item.side, item.wallStyle);
            const report = validateManifold(geometry);
            expect(report.isWatertight, item.key).toBe(true);
            expect(report.eulerCharacteristic, item.key).toBe(2);
            const sha = meshSha256(geometry);
            recorded[item.key] = sha;
            expect(sha, item.key).toBe(MAIN_SOLID_SHA256[item.key]);
            geometry.dispose();
        }
        writeFileSync("/tmp/print-solid-golden.last.json", `${JSON.stringify(recorded, null, 2)}\n`);
        expect(stock.usMenSize ?? 9).toBe(9);
        expect(stock.shoeWidth).toBe("medium");
        native.dispose();
    }, 900_000);
});
