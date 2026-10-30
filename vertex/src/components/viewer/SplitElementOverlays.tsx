// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { isLibraryHeightFieldKind } from "@/lib/geometry/element-assets/types";
import { ElementHardnessPopup } from "./ElementHardnessPopup";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { elementPreviewColor, splitOverlayOutline } from "@/lib/hardness/split-overlay";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { PlacedElement } from "@/types";
import { SELECTED_ELEMENT_HIGHLIGHT } from "../../../shared/print-recipe/hardness-class-table";

function outlineGeometry(pts: { x: number; y: number }[]): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    const first = pts[0];
    if (!first) {
        shape.absellipse(0, 0, 8, 8, 0, Math.PI * 2, false, 0);
    } else {
        shape.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i];
            if (p) shape.lineTo(p.x, p.y);
        }
        shape.closePath();
    }
    return new THREE.ShapeGeometry(shape);
}

function SplitPatch({
    element,
    centerX,
    widthMm,
}: {
    element: PlacedElement;
    centerX: number;
    widthMm: number;
}) {
    const splitOn = useDesignStore((s) => Boolean(s.design.splitElements));
    const selectedId = useDesignStore((s) => s.selectedElementId);
    const selectElement = useDesignStore((s) => s.selectElement);
    const preview = usePerformanceStore((s) => s.elementPreviews[element.id]);
    const pos = preview?.position ?? element.position;
    const rot = preview?.rotationDeg ?? element.rotationDeg;
    const heightMm = preview?.heightMm ?? element.heightMm;
    const selected = selectedId === element.id;
    const color = elementPreviewColor(element, true, selected, splitOn);

    const { fill, ring } = useMemo(() => {
        const pts = splitOverlayOutline({
            ...element,
            scale: preview?.scale ?? element.scale,
        });
        const fillGeo = outlineGeometry(pts);
        const ringPts = pts.map((p) => new THREE.Vector3(p.x, p.y, 0.15));
        if (ringPts[0]) ringPts.push(ringPts[0].clone());
        const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
        return { fill: fillGeo, ring: ringGeo };
    }, [element, preview?.scale]);

    useEffect(
        () => () => {
            fill.dispose();
            ring.dispose();
        },
        [fill, ring],
    );

    const z = Math.max(0.8, heightMm) + 0.35;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <group position={[-centerX, sideOffsetX(element.side, widthMm), 0]}>
                <group position={[centerX + pos.x, pos.y, z]} rotation={[0, 0, (rot * Math.PI) / 180]}>
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: R3F mesh pick target */}
                    <mesh
                        geometry={fill}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            selectElement(element.id);
                        }}
                        onPointerOver={(e) => {
                            e.stopPropagation();
                            document.body.style.cursor = "pointer";
                        }}
                        onPointerOut={() => {
                            document.body.style.cursor = "";
                        }}
                    >
                        <meshStandardMaterial
                            color={color}
                            transparent
                            opacity={1}
                            metalness={0.05}
                            roughness={0.55}
                            depthWrite={false}
                            side={THREE.DoubleSide}
                        />
                    </mesh>
                    {selected ? (
                        <line geometry={ring}>
                            <lineBasicMaterial color={SELECTED_ELEMENT_HIGHLIGHT} linewidth={2} />
                        </line>
                    ) : null}
                    {selected ? <ElementHardnessPopup elementId={element.id} position={[0, 0, 0.2]} /> : null}
                </group>
            </group>
        </group>
    );
}

export function SplitElementOverlays() {
    const elements = useDesignStore((s) => s.design.elements);
    const usMenSize = useDesignStore((s) => s.design.usMenSize);
    const sizeSystem = useDesignStore((s) => s.design.sizeSystem);
    const ukSize = useDesignStore((s) => s.design.ukSize);
    const footLengthMm = useDesignStore((s) => s.design.footLengthMm);
    const layout = insoleLayoutFromDesign({ sizeSystem, usMenSize, ukSize, footLengthMm });
    const centerX = layout.lengthMm / 2;

    if (elements.length === 0) return null;

    return (
        <group>
            {elements
                .filter((el) => !isLibraryHeightFieldKind(el.kind))
                .map((el) => (
                    <SplitPatch key={el.id} element={el} centerX={centerX} widthMm={layout.widthMm} />
                ))}
        </group>
    );
}
