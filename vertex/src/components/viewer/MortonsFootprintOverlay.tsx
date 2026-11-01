// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { getDesignBase } from "@/lib/geometry/base-asset";
import { outlineHalfWidth } from "@/lib/geometry/height-field";
import { sideOffsetX } from "@/lib/geometry/layout";
import { clipMortonsOutline, mortonsActive, mortonsRegionOutlineMm } from "@/lib/geometry/mortons";
import { SAMPLE_TOP_ASSET_ID } from "@/lib/geometry/procedural-wall/sample-top-id";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { useBaseBoundsStore } from "@/stores/base-bounds-store";
import { useDesignStore } from "@/stores/design-store";
import type { MortonsSide, Side } from "@/types";

/** Distinct from sink footprints so the first-ray region reads on a gray shell. */
const MORTONS_FOOTPRINT = "#22d3ee";

/** Local width range from a closed footprint ring, sampled along length. */
function spanFromOutline(
    outline: { x: number; y: number }[],
): (u: number) => { lo: number; hi: number } | null {
    const n = 256;
    const lo = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    const hi = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of outline) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const span = Math.max(1e-3, maxX - minX);
    for (const p of outline) {
        let s = Math.round(((p.x - minX) / span) * (n - 1));
        if (s < 0) s = 0;
        else if (s > n - 1) s = n - 1;
        if (p.y < lo[s]!) lo[s] = p.y;
        if (p.y > hi[s]!) hi[s] = p.y;
    }
    const known: number[] = [];
    for (let s = 0; s < n; s++) {
        if (lo[s]! < hi[s]!) known.push(s);
    }
    if (known.length === 0) return () => null;
    return (u) => {
        const f = Math.max(0, Math.min(1, u)) * (n - 1);
        let loS = known[0]!;
        let hiS = known[known.length - 1]!;
        for (let k = 0; k < known.length; k++) {
            const s = known[k]!;
            if (s <= f) loS = s;
            if (s >= f) {
                hiS = s;
                break;
            }
        }
        if (loS === hiS) return { lo: lo[loS]!, hi: hi[loS]! };
        const t = (f - loS) / (hiS - loS);
        return {
            lo: lo[loS]! + (lo[hiS]! - lo[loS]!) * t,
            hi: hi[loS]! + (hi[hiS]! - hi[loS]!) * t,
        };
    };
}

function Footprint({
    side,
    spec,
    lengthMm,
    widthMm,
    offsetWidthMm,
    originX,
    outline,
}: {
    side: Side;
    spec: MortonsSide;
    lengthMm: number;
    widthMm: number;
    offsetWidthMm: number;
    originX: number;
    outline: { points: { x: number; y: number }[] } | null;
}) {
    const { fill, ring } = useMemo(() => {
        const raw = mortonsRegionOutlineMm({
            side,
            lengthMm,
            widthMm,
            mortons: spec,
            widthMmAt: (u) => outlineHalfWidth(u) * widthMm,
        });
        const pts = outline?.points?.length
            ? clipMortonsOutline(
                  raw,
                  lengthMm,
                  spanFromOutline(outline.points.map((p) => ({ x: p.x, y: p.y }))),
              )
            : raw;
        if (pts.length < 3) return { fill: null as THREE.BufferGeometry | null, ring: null };
        const shape = new THREE.Shape();
        const first = pts[0]!;
        shape.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i]!;
            shape.lineTo(p.x, p.y);
        }
        shape.closePath();
        const fillGeo = new THREE.ShapeGeometry(shape);
        const ringPts = pts.map((p) => new THREE.Vector3(p.x, p.y, 0));
        ringPts.push(ringPts[0]!.clone());
        const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
        return { fill: fillGeo, ring: ringGeo };
    }, [side, spec, lengthMm, widthMm, outline]);

    useEffect(
        () => () => {
            fill?.dispose();
            ring?.dispose();
        },
        [fill, ring],
    );

    if (!fill || !ring) return null;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <group position={[-originX, sideOffsetX(side, offsetWidthMm), 0]}>
                <mesh geometry={fill} position={[0, 0, 12]} renderOrder={4}>
                    <meshBasicMaterial
                        color={MORTONS_FOOTPRINT}
                        transparent
                        opacity={0.38}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
                <line geometry={ring} position={[0, 0, 12.6]} renderOrder={5}>
                    <lineBasicMaterial color={MORTONS_FOOTPRINT} />
                </line>
            </group>
        </group>
    );
}

/** Cyan plan of the Morton's region on each foot that has the modifier on. */
export function MortonsFootprintOverlay() {
    const design = useDesignStore((s) => s.design);
    const bounds = useBaseBoundsStore((s) => s.bounds);
    const layout = insoleLayoutFromDesign(design);
    const sides: Side[] = ["left", "right"];

    return (
        <>
            {sides.map((side) => {
                const spec = design.mortons?.[side];
                if (!spec || !mortonsActive(spec)) return null;
                const base = getDesignBase(design, side);
                const key = `${SAMPLE_TOP_ASSET_ID}:${side}:${base?.mirrored ? "m" : "p"}`;
                const mesh = bounds[key];
                const lengthMm = mesh?.lengthMm && mesh.lengthMm > 1 ? mesh.lengthMm : layout.lengthMm;
                const widthMm = mesh?.widthMm && mesh.widthMm > 1 ? mesh.widthMm : layout.widthMm;
                const outline = mesh?.outline ?? null;
                return (
                    <Footprint
                        key={side}
                        side={side}
                        spec={spec}
                        lengthMm={lengthMm}
                        widthMm={widthMm}
                        offsetWidthMm={layout.widthMm}
                        originX={layout.lengthMm / 2}
                        outline={outline}
                    />
                );
            })}
        </>
    );
}
