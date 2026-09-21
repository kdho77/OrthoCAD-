// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { HARDNESS_OVERLAY_HEX } from "../../../shared/print-recipe/hardness-zone-presets";
import {
    attachSoleUvFrameToRecipe,
    migratePrintRecipe,
    type MaterialZoneV1,
} from "../../../shared/print-recipe/print-recipe";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { DesignState, Side } from "@/types";

interface HardnessZonesFootOverlayProps {
    side: Side;
    design: DesignState;
}

function zoneShapeGeometry(zone: MaterialZoneV1, lengthMm: number, widthMm: number): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    zone.boundarySoleUv.forEach((p, i) => {
        const x = p.u * lengthMm;
        const y = p.v * (widthMm / 2);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    });
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
}

/** Semi-transparent sole-footprint tint for regional hardness (v1; complements panel UV map). */
export function HardnessZonesFootOverlay({ side, design }: HardnessZonesFootOverlayProps) {
    const layout = insoleLayoutFromDesign(design);
    const recipe = attachSoleUvFrameToRecipe(
        migratePrintRecipe(design.printRecipe),
        layout.lengthMm,
        layout.widthMm,
    );
    const zones = recipe.zones;

    const zoneMeshes = useMemo(() => {
        if (!zones.length) return [];
        return zones.map((z) => {
            const geo = zoneShapeGeometry(z, layout.lengthMm, layout.widthMm);
            const hex = HARDNESS_OVERLAY_HEX[z.hardnessName] ?? "#94a3b8";
            const mat = new THREE.MeshBasicMaterial({
                color: hex,
                transparent: true,
                opacity: 0.38,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                side: THREE.DoubleSide,
            });
            return { zoneId: z.zoneId, geo, mat };
        });
    }, [zones, layout.lengthMm, layout.widthMm]);

    useEffect(
        () => () => {
            for (const m of zoneMeshes) {
                m.geo.dispose();
                m.mat.dispose();
            }
        },
        [zoneMeshes],
    );

    if (!zoneMeshes.length) return null;

    const offsetX = sideOffsetX(side, layout.widthMm);

    return (
        <group rotation={[-Math.PI / 2, 0, 0]} position={[-layout.lengthMm / 2, offsetX, 0]}>
            {zoneMeshes.map(({ zoneId, geo, mat }) => (
                <mesh key={zoneId} geometry={geo} material={mat} position={[0, 0, 0.25]} renderOrder={5} />
            ))}
        </group>
    );
}
