// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { crestHasOverrideMarkers } from "./crest";
import { AFO_C_MM, AFO_THICKNESS_RANGE, AFO_THICKNESS_WARN_MM } from "./defaults";
import { geodesicDistanceField } from "./geodesic";
import { nearestVertex, vertexCount } from "./mesh-ops";
import type { AfoDesignState, AfoTriMesh, AfoWarning } from "./types";

export function evaluateAfoWarnings(afo: AfoDesignState, mesh: AfoTriMesh | null): AfoWarning[] {
    const out: AfoWarning[] = [];
    const cCast = afo.cast.removeCastMm;
    if (cCast > 3) {
        out.push({ id: "remove_cast_high", message: "Remove Cast > +3 mm", blocking: false });
    }
    if (cCast < -5) {
        out.push({ id: "remove_cast_low", message: "Remove Cast < −5 mm", blocking: false });
    }
    if (afo.corrections.legSideDeg > 5) {
        out.push({ id: "df_high", message: "Sagittal DF > +5°", blocking: false });
    }
    if (Math.abs(afo.corrections.legRearDeg) > 5) {
        out.push({ id: "frontal_high", message: "Frontal rotation |deg| > 5°", blocking: false });
    }
    if (afo.corrections.legSideDeg > 5 && afo.corrections.heelLiftMm > 8) {
        out.push({
            id: "df_heel",
            message: "DF > 5° with heel lift > 8 mm",
            blocking: false,
        });
    }
    if (afo.cast.insensate) {
        out.push({ id: "insensate", message: "Insensate mode active", blocking: false });
    }
    if (afo.print.thicknessMm < AFO_THICKNESS_WARN_MM) {
        out.push({
            id: "wall_thin",
            message: `Wall < ${AFO_THICKNESS_WARN_MM} mm (hard min ${AFO_THICKNESS_RANGE[0]} mm)`,
            blocking: false,
        });
    }

    const hasNav = afo.clinicalMarkers.some((m) => m.id === "navicular");
    if (!hasNav) {
        out.push({ id: "place_navicular", message: "place navicular marker", blocking: false });
    }

    const reliefOn = afo.cast.insensate
        ? { navicular: true, fifthMetBase: true, postCalcaneus: true, fibularHead: true, malleoli: true }
        : {
              navicular: afo.reliefs.navicular.on,
              fifthMetBase: afo.reliefs.fifthMetBase.on,
              postCalcaneus: afo.reliefs.postCalcaneus.on,
              fibularHead: afo.reliefs.fibularHead.on,
              malleoli: afo.reliefs.malleoli.on,
          };
    const missing: string[] = [];
    if (reliefOn.navicular && !hasNav) missing.push("navicular");
    if (reliefOn.fifthMetBase && !afo.clinicalMarkers.some((m) => m.id === "fifth_met_base")) {
        missing.push("5th met base");
    }
    if (reliefOn.postCalcaneus && !afo.clinicalMarkers.some((m) => m.id === "post_calcaneus")) {
        missing.push("post calcaneus");
    }
    if (reliefOn.fibularHead && !afo.clinicalMarkers.some((m) => m.id === "fibular_head")) {
        missing.push("fibular head");
    }
    const hasMal =
        afo.landmarks.some((l) => l.id === "malleolus_medial" || l.id === "malleolus_lateral") ||
        Boolean(afo.clinicalMarkers.find((m) => m.id === "navicular"));
    void hasMal;
    if (afo.cast.insensate && missing.length) {
        out.push({
            id: "insensate_markers",
            message: `place missing markers: ${missing.join(", ")}`,
            blocking: false,
        });
    }

    const fib = afo.clinicalMarkers.find((m) => m.id === "fibular_head");
    if (mesh && afo.trimPoints.length > 0) {
        if (fib) {
            const src = nearestVertex(mesh, fib.point).index;
            const geo = geodesicDistanceField(mesh, [src]);
            const near = afo.trimPoints.some((p) => (geo[p.vertexIndex] ?? Infinity) <= 20);
            if (near) {
                out.push({
                    id: "trim_fib_head",
                    message: "Trim is within 20 mm of the fibular head",
                    blocking: false,
                });
            }
        } else {
            let top = -Infinity;
            for (const p of afo.trimPoints) top = Math.max(top, p.point.z);
            if (top > AFO_C_MM + 250) {
                out.push({
                    id: "place_fibular_head",
                    message: "place fibular head marker",
                    blocking: false,
                });
            }
        }
    } else if (!fib && mesh) {
        const n = vertexCount(mesh);
        let top = -Infinity;
        for (let i = 0; i < n; i++) top = Math.max(top, mesh.positions[i * 3 + 2] ?? 0);
        // Design-time trim warning is evaluated when trim exists; skip here.
        void top;
    }

    const crestBlock =
        afo.crest.lowConfidence && !afo.crest.override && !crestHasOverrideMarkers(afo.clinicalMarkers);
    if (crestBlock) {
        out.push({
            id: "crest_markers",
            message: "Low-confidence tibial crest — place tibial tuberosity and distal crest end",
            blocking: true,
        });
    }

    return out;
}

export function warningHas(warnings: AfoWarning[], id: string): boolean {
    return warnings.some((w) => w.id === id);
}
