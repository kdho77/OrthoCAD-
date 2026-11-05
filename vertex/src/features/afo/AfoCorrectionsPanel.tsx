// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useState } from "react";
import { SliderField } from "@/components/ui/slider-field";
import {
    applyAfoCorrections,
    correctionContextFromAfo,
    defaultAfoText,
    measureShankAngles,
} from "@/lib/geometry/afo/corrections";
import {
    AFO_ARCH_RANGE,
    AFO_BRACE_HEIGHT_MM,
    AFO_BRACE_HEIGHT_RANGE,
    AFO_HEEL_LIFT_RANGE,
    AFO_HEEL_WIDTH_RANGE,
    AFO_REAR_ROT_RANGE,
    AFO_SIDE_ROT_RANGE,
    AFO_SMOOTH_ITERATIONS,
    AFO_SMOOTH_RANGE,
    AFO_TEXT_DEPTH_MM,
    AFO_TOE_RISE_RANGE,
    AFO_VOLUME_FEATHER_MM,
    AFO_VOLUME_OFFSET_RANGE,
    correctionsForSide,
    defaultAfoCorrections,
} from "@/lib/geometry/afo/defaults";
import { evaluateAfoWarnings } from "@/lib/geometry/afo/warnings";
import { getAfoState, patchAfoState, refreshAfoWorkingMesh, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { SIDE_LABELS } from "@/types";

export function AfoCorrectionsPanel() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const c = afo.corrections ?? defaultAfoCorrections();
    const side = afo.side;
    const placement = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
    const scanned =
        placement === "both" ? side : placement === "left" || placement === "right" ? placement : side;
    const castMesh = useAfoStore((s) => s.castMesh);
    const setCorrected = useAfoStore((s) => s.setCorrectedMesh);

    const [editSide, setEditSide] = useState<"left" | "right">(side === "right" ? "right" : "left");
    const edited = (editSide === "right" ? c.right : c.left) ?? c;
    const volume = c.volumeRegions?.[0];
    const axes = correctionContextFromAfo(afo);
    const warnings = evaluateAfoWarnings(afo, castMesh);
    const measured = castMesh ? measureShankAngles(castMesh, axes) : null;

    const patch = (partial: Partial<typeof edited>) => {
        const nextSide = { ...edited, ...partial };
        const corrections = {
            ...c,
            ...(editSide === afo.side ? nextSide : {}),
            left: editSide === "left" ? nextSide : c.left,
            right: editSide === "right" ? nextSide : c.right,
        };
        patchAfoState({ corrections }, "afo-corrections");
        if (castMesh) {
            setCorrected(
                applyAfoCorrections(castMesh, correctionsForSide(corrections, afo.side), {
                    ...axes,
                    anatomical: true,
                }),
            );
        }
    };

    const patchShared = (partial: Partial<typeof c>) => {
        const corrections = { ...c, ...partial };
        patchAfoState({ corrections }, "afo-corrections");
        refreshAfoWorkingMesh();
    };

    return (
        <div className="space-y-3 text-xs">
            <p className="text-muted-foreground">
                Left and right are stored separately. The model shows {SIDE_LABELS[scanned]}. Smooth is
                shared. Rotation is the same control as the Cast tab.
            </p>
            <div className="flex gap-1">
                {(["left", "right"] as const).map((id) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setEditSide(id)}
                        className={`h-7 flex-1 rounded border text-[11px] ${editSide === id ? "border-primary bg-primary/20" : "border-border"}`}
                    >
                        {id === "left" ? "Left" : "Right"}
                    </button>
                ))}
            </div>
            {scanned === "left" || scanned === "right" ? (
                <div className="space-y-2">
                    <SliderField
                        label="Rotate Rear View"
                        value={edited.legRearDeg}
                        min={AFO_REAR_ROT_RANGE[0]}
                        max={AFO_REAR_ROT_RANGE[1]}
                        step={0.5}
                        unit="°"
                        defaultValue={0}
                        onChange={(v) => patch({ legRearDeg: v })}
                    />
                    <SliderField
                        label="Rotate Side View"
                        value={edited.legSideDeg}
                        min={AFO_SIDE_ROT_RANGE[0]}
                        max={AFO_SIDE_ROT_RANGE[1]}
                        step={0.5}
                        unit="°"
                        defaultValue={0}
                        onChange={(v) => patch({ legSideDeg: v })}
                    />
                    {measured ? (
                        <p className="text-[10px] text-muted-foreground">
                            Measured after rotation: side {measured.sagittalDeg.toFixed(1)}°, rear{" "}
                            {measured.frontalDeg.toFixed(1)}°. Positive side is dorsiflexion. Positive rear is
                            varus.
                        </p>
                    ) : null}
                    <SliderField
                        label="Heel Lift"
                        value={edited.heelLiftMm}
                        min={AFO_HEEL_LIFT_RANGE[0]}
                        max={AFO_HEEL_LIFT_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ heelLiftMm: v })}
                    />
                    <SliderField
                        label="Toe Rise"
                        value={edited.toeRiseMm ?? 0}
                        min={AFO_TOE_RISE_RANGE[0]}
                        max={AFO_TOE_RISE_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ toeRiseMm: v })}
                    />
                    <SliderField
                        label="Medial arch"
                        value={edited.medialArchMm}
                        min={AFO_ARCH_RANGE[0]}
                        max={AFO_ARCH_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ medialArchMm: v })}
                    />
                    <SliderField
                        label="Heel width"
                        value={edited.heelWidthMm}
                        min={AFO_HEEL_WIDTH_RANGE[0]}
                        max={AFO_HEEL_WIDTH_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ heelWidthMm: v })}
                    />
                    <SliderField
                        label="Brace height"
                        value={edited.braceHeightMm}
                        min={AFO_BRACE_HEIGHT_RANGE[0]}
                        max={AFO_BRACE_HEIGHT_RANGE[1]}
                        unit="mm"
                        defaultValue={AFO_BRACE_HEIGHT_MM}
                        onChange={(v) => patch({ braceHeightMm: v })}
                    />
                    <SliderField
                        label="Smooth"
                        value={c.smoothIterations}
                        min={AFO_SMOOTH_RANGE[0]}
                        max={AFO_SMOOTH_RANGE[1]}
                        step={1}
                        defaultValue={AFO_SMOOTH_ITERATIONS}
                        onChange={(v) => patchShared({ smoothIterations: Math.round(v) })}
                    />
                    <SliderField
                        label="Add volume"
                        value={volume?.offsetMm ?? 2}
                        min={AFO_VOLUME_OFFSET_RANGE[0]}
                        max={AFO_VOLUME_OFFSET_RANGE[1]}
                        unit="mm"
                        defaultValue={2}
                        onChange={(v) =>
                            patchShared({
                                volumeRegions: [
                                    {
                                        id: "volume",
                                        vertexIndices: volume?.vertexIndices ?? [],
                                        offsetMm: v,
                                        featherMm: volume?.featherMm ?? 10,
                                    },
                                ],
                            })
                        }
                    />
                    <SliderField
                        label="Volume feather"
                        value={volume?.featherMm ?? 10}
                        min={AFO_VOLUME_FEATHER_MM[0]}
                        max={AFO_VOLUME_FEATHER_MM[1]}
                        unit="mm"
                        defaultValue={10}
                        onChange={(v) =>
                            patchShared({
                                volumeRegions: [
                                    {
                                        id: "volume",
                                        vertexIndices: volume?.vertexIndices ?? [],
                                        offsetMm: volume?.offsetMm ?? 2,
                                        featherMm: v,
                                    },
                                ],
                            })
                        }
                    />
                    <button
                        type="button"
                        className="h-7 w-full rounded border border-border"
                        onClick={() => {
                            const nav = afo.clinicalMarkers.find((m) => m.id === "navicular");
                            if (!castMesh || !nav) return;
                            const ids: number[] = [];
                            for (let i = 0; i < castMesh.positions.length / 3; i++) {
                                const dx = (castMesh.positions[i * 3] ?? 0) - nav.point.x;
                                const dy = (castMesh.positions[i * 3 + 1] ?? 0) - nav.point.y;
                                const dz = (castMesh.positions[i * 3 + 2] ?? 0) - nav.point.z;
                                if (Math.hypot(dx, dy, dz) <= 12) ids.push(i);
                            }
                            patchShared({
                                volumeRegions: [
                                    {
                                        id: "volume",
                                        vertexIndices: ids,
                                        offsetMm: volume?.offsetMm ?? 2,
                                        featherMm: volume?.featherMm ?? 10,
                                    },
                                ],
                            });
                        }}
                    >
                        Paint volume at navicular
                    </button>
                    <label className="block text-[10px] text-muted-foreground">
                        Text ({c.patientName || "PATIENT"} {editSide === "left" ? "L" : "R"})
                        <input
                            className="mt-1 h-7 w-full rounded border border-border bg-background px-2 text-foreground"
                            value={c.text?.text ?? defaultAfoText(c.patientName, editSide)}
                            onChange={(e) =>
                                patchShared({
                                    text: {
                                        text: e.target.value,
                                        depthMm: c.text?.depthMm ?? 0.5,
                                        anchor: c.text?.anchor ?? null,
                                    },
                                })
                            }
                        />
                    </label>
                    <SliderField
                        label="Text depth"
                        value={c.text?.depthMm ?? 0.5}
                        min={AFO_TEXT_DEPTH_MM[0]}
                        max={AFO_TEXT_DEPTH_MM[1]}
                        step={0.1}
                        unit="mm"
                        defaultValue={0.5}
                        onChange={(v) =>
                            patchShared({
                                text: {
                                    text: c.text?.text ?? defaultAfoText(c.patientName, editSide),
                                    depthMm: v,
                                    anchor: null,
                                },
                            })
                        }
                    />
                </div>
            ) : (
                <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-muted-foreground">
                    Select the scanned foot above to edit corrections.
                </p>
            )}
            {warnings.map((w) => (
                <p key={w.id} className="text-[11px] text-amber-200/90">
                    Warn: {w.message}
                </p>
            ))}
        </div>
    );
}
