// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { booleanTextSolid } from "./boolean";
import { hasActiveTextMarking, TEXT_BOOLEAN_EPS_MM, TEXT_BOOLEAN_OUTSET_MM, TEXT_CAP } from "./constants";
import { flattenText } from "./contours";
import { TextMarkingError } from "./errors";
import { loadTextFont } from "./font";
import { assertTextPrintGates } from "./gates";
import {
    extractHostTextContext,
    localWallHeightMm,
    localWallThicknessMm,
    placeBottomText,
    placeWallText,
} from "./place";
import type { TextApplyContext, TextApplyMeta, TextMarking } from "./types";
import { assertTextMarkingInRange } from "./validate";

function shrinkThenFlatten(
    font: Awaited<ReturnType<typeof loadTextFont>>,
    marking: TextMarking,
    minCap: number,
    tryPlace: (flat: ReturnType<typeof flattenText>, cap: number) => void,
): ReturnType<typeof flattenText> {
    let cap = marking.capHeightMm;
    let lastErr: unknown;
    while (cap + 1e-6 >= minCap) {
        try {
            const flat = flattenText(font, marking.text, cap, marking.letterSpacingMm, marking.bold);
            tryPlace(flat, cap);
            return flat;
        } catch (e) {
            lastErr = e;
            if (e instanceof TextMarkingError && e.code === "too-thin") throw e;
            cap = Math.max(minCap, cap - 0.5);
            if (cap <= minCap + 1e-6) break;
        }
    }
    try {
        const flat = flattenText(font, marking.text, minCap, marking.letterSpacingMm, marking.bold);
        tryPlace(flat, minCap);
        return flat;
    } catch (e) {
        throw lastErr instanceof Error ? lastErr : e;
    }
}

/**
 * After composePrintSolidTop + loft: build one closed text solid and run a
 * single manifold-3d boolean. Empty text is a no-op (same geometry object).
 */
export async function applyTextMarkingToPrintSolid(
    host: BufferGeometry,
    marking: TextMarking | null | undefined,
    ctx: TextApplyContext,
): Promise<BufferGeometry> {
    if (!hasActiveTextMarking(marking) || !marking) return host;
    const hostCtx = extractHostTextContext(host);
    const wallH = localWallHeightMm(hostCtx, marking.placementU);
    const wallT = localWallThicknessMm(hostCtx, marking.placementU);
    const localThickness =
        marking.surface === "wall" ? wallT : ((host.userData as { thicknessMm?: number }).thicknessMm ?? 8);
    const checked = assertTextMarkingInRange(marking, {
        wallHeightMm: wallH || undefined,
        localThicknessMm: localThickness,
    });
    const font = await loadTextFont();
    const minCap = checked.surface === "wall" ? TEXT_CAP.wall.min : TEXT_CAP.bottom.min;

    let placedFlat: ReturnType<typeof flattenText>;
    let map: ReturnType<typeof placeBottomText>["map"];
    let rebind: ((geo: typeof host) => typeof map) | undefined;
    let placeMeta: Pick<TextApplyMeta, "centroids" | "mappedWidthMm" | "wallUMin" | "wallUMax">;
    if (checked.surface === "bottom") {
        placedFlat = shrinkThenFlatten(font, checked, minCap, (flat) => {
            placeBottomText(host, hostCtx, { ...checked, capHeightMm: flat.capHeightMm }, flat, ctx.side);
        });
        const placed = placeBottomText(
            host,
            hostCtx,
            { ...checked, capHeightMm: placedFlat.capHeightMm },
            placedFlat,
            ctx.side,
        );
        placedFlat = placed.flat;
        map = placed.map;
        placeMeta = placed.meta;
    } else {
        placedFlat = shrinkThenFlatten(font, checked, minCap, (flat) => {
            placeWallText(host, hostCtx, { ...checked, capHeightMm: flat.capHeightMm }, flat);
        });
        const placed = placeWallText(
            host,
            hostCtx,
            { ...checked, capHeightMm: placedFlat.capHeightMm },
            placedFlat,
        );
        placedFlat = placed.flat;
        map = placed.map;
        rebind = placed.rebind;
        placeMeta = placed.meta;
    }

    const op = checked.mode === "emboss" ? "add" : "subtract";
    const result = await booleanTextSolid(
        host,
        placedFlat.groups,
        map,
        op,
        rebind,
        checked.surface === "wall" ? undefined : 1,
    );
    const poke = checked.surface === "wall" ? TEXT_BOOLEAN_OUTSET_MM : TEXT_BOOLEAN_EPS_MM;
    const span = checked.mode === "engrave" ? checked.depthMm + poke : checked.heightMm + poke;
    const tSurface =
        checked.surface === "wall"
            ? checked.mode === "engrave"
                ? checked.depthMm / Math.max(1e-9, span)
                : poke / Math.max(1e-9, span)
            : poke / Math.max(1e-9, span);
    const outlineWorld = placedFlat.groups.map((g) => ({
        outer: g.outer.map((p) => map(p, tSurface)),
        holes: g.holes.map((h) => h.map((p) => map(p, tSurface))),
    }));
    const meta: TextApplyMeta = {
        surface: checked.surface,
        mode: checked.mode,
        depthMm: checked.mode === "engrave" ? checked.depthMm : 0,
        heightMm: checked.mode === "emboss" ? checked.heightMm : 0,
        capHeightMm: placedFlat.capHeightMm,
        advanceMm: placedFlat.advanceMm,
        centroids: placeMeta.centroids,
        mappedWidthMm: placeMeta.mappedWidthMm,
        wallUMin: placeMeta.wallUMin,
        wallUMax: placeMeta.wallUMax,
        outlineWorld,
    };
    assertTextPrintGates(result, meta, hostCtx.outline);
    return result;
}
