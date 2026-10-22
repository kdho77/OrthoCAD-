// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
    setTextDragU,
    useTextDragU,
    useTextFitAlert,
    useTextGuides,
} from "@/features/exports/text-guide-store";
import { isSideText, TEXT_U } from "@/lib/geometry/text-marking/constants";
import type { TextGuideStation } from "@/lib/geometry/text-marking/place";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import type { Side, TextSurface } from "@/types";

function nearestStation(
    stations: TextGuideStation[],
    x: number,
    y: number,
    alongX: boolean,
): TextGuideStation | null {
    let best: TextGuideStation | null = null;
    let bestD = Infinity;
    for (const st of stations) {
        const d = alongX ? Math.abs(st.x - x) : (st.x - x) ** 2 + (st.y - y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = st;
        }
    }
    return best;
}

function guideLine(
    surface: TextSurface,
    stations: TextGuideStation[],
    u: number,
    midY: number,
    nudgeAcross: number,
    seamInsetMm = 0,
): THREE.Vector3[] {
    if (!stations.length) return [];
    if (!isSideText(surface)) {
        const st = stations.reduce((a, b) => (Math.abs(a.u - u) < Math.abs(b.u - u) ? a : b));
        const y = midY + nudgeAcross;
        return [new THREE.Vector3(st.x - 18, y, 0.8), new THREE.Vector3(st.x + 18, y, 0.8)];
    }
    const near = stations.filter((st) => Math.abs(st.u - u) < 0.06).sort((a, b) => a.s - b.s);
    const band =
        near.length >= 2
            ? near
            : [stations.reduce((a, b) => (Math.abs(a.u - u) < Math.abs(b.u - u) ? a : b))];
    return band.map((st) => {
        const h = Math.max(st.h, 0.5);
        const t = Math.min(0.85, Math.max(0.12, 0.5 + nudgeAcross / h - seamInsetMm / h));
        return new THREE.Vector3(
            st.bx + (st.x - st.bx) * t,
            st.by + (st.y - st.by) * t,
            st.bz + (st.z - st.bz) * t + 0.3,
        );
    });
}

function stationsForSurface(surface: TextSurface, lateral: TextGuideStation[], medial: TextGuideStation[]) {
    if (surface === "medial") return medial;
    if (surface === "wall") return lateral;
    return [...lateral, ...medial];
}

/** Placement line. Amber while a fit warning is open. */
export function TextPlacementGuide({ side }: { side: Side }) {
    const marking = useDesignStore((s) => s.design.textMarking);
    const step = useClinicalWorkflowStore((s) => s.step);
    const guides = useTextGuides();
    const dragU = useTextDragU();
    const alert = useTextFitAlert();
    const guide = guides[side];
    const active =
        Boolean(marking && (marking.text || marking.textLeft || marking.textRight)) && step === "elements";
    const clamp = dragU == null ? guide?.placementClamp : null;
    const u = dragU ?? clamp?.u ?? marking?.placementU ?? 0.32;
    const points = useMemo(() => {
        if (!guide || !marking || !active) return [];
        const stations = stationsForSurface(marking.surface, guide.lateral, guide.medial);
        return guideLine(
            marking.surface,
            stations,
            u,
            guide.midY,
            marking.nudgeAcrossMm,
            clamp?.seamInsetMm ?? 0,
        );
    }, [active, clamp?.seamInsetMm, guide, marking, u]);

    const line = useMemo(() => {
        const geom = new THREE.BufferGeometry();
        if (points.length >= 2) geom.setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color: alert ? "#fbbf24" : clamp ? "#38bdf8" : "#facc15",
            depthTest: false,
        });
        const mesh = new THREE.Line(geom, mat);
        mesh.renderOrder = 20;
        return mesh;
    }, [alert, clamp, points]);

    useEffect(
        () => () => {
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
        },
        [line],
    );

    if (!active || points.length < 2) return null;
    return <primitive object={line} />;
}

/** Mesh pointer handlers. Commits placementU on pointer-up and snaps across to centre / mid-height. */
export function useTextSurfaceDrag(side: Side) {
    const marking = useDesignStore((s) => s.design.textMarking);
    const setTextMarking = useDesignStore((s) => s.setTextMarking);
    const step = useClinicalWorkflowStore((s) => s.step);
    const guides = useTextGuides();
    const dragU = useTextDragU();
    const controls = useThree((s) => s.controls) as { enabled?: boolean } | null;
    const guide = guides[side];

    const placeAt = (e: ThreeEvent<PointerEvent>) => {
        if (!marking || !guide || step !== "elements") return false;
        if (!marking.text && !marking.textLeft && !marking.textRight) return false;
        const n = e.face?.normal;
        if (!n) return false;
        const nz = Math.abs(n.z);
        if (marking.surface === "bottom" ? nz < 0.65 : nz > 0.5) return false;
        const local = e.object.worldToLocal(e.point.clone());
        const stations = stationsForSurface(marking.surface, guide.lateral, guide.medial);
        if (isSideText(marking.surface) && stations[0]) {
            const runNeg = stations[0].y < guide.midY;
            if (runNeg !== local.y < guide.midY) return false;
        }
        const st = nearestStation(stations, local.x, local.y, marking.surface === "bottom");
        if (!st) return false;
        const band = isSideText(marking.surface) ? TEXT_U.wall : TEXT_U.bottom;
        setTextDragU(Math.min(band.max, Math.max(band.min, st.u)));
        return true;
    };

    return {
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
            if (!placeAt(e)) return;
            e.stopPropagation();
            (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
            if (controls) controls.enabled = false;
        },
        onPointerMove: (e: ThreeEvent<PointerEvent>) => {
            if (dragU == null) return;
            if (!placeAt(e)) return;
            e.stopPropagation();
        },
        onPointerUp: () => {
            if (controls) controls.enabled = true;
            const u = dragU;
            if (u != null && marking) {
                setTextMarking({ placementU: u, nudgeAcrossMm: 0 });
            }
            setTextDragU(null);
        },
    };
}
