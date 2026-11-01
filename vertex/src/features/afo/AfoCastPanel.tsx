// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { SliderField } from "@/components/ui/slider-field";
import {
    AFO_CLINICAL_MARKERS,
    AFO_RELIEF_RANGE,
    AFO_REMOVE_CAST_RANGE,
    AFO_SHIN_OFFSET_RANGE,
    AFO_TOE_BOX_PCT_RANGE,
    defaultAfoCast,
    defaultAfoReliefs,
} from "@/lib/geometry/afo/defaults";
import { evaluateAfoWarnings } from "@/lib/geometry/afo/warnings";
import { getAfoState, patchAfoState, refreshAfoWorkingMesh, useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";
import type { ProductionMethod } from "@/types";

const METHODS: { id: ProductionMethod; label: string }[] = [
    { id: "printing_shell", label: "3D print shell" },
    { id: "printing_solid", label: "3D print solid" },
    { id: "milling_3axis", label: "Mill (3-axis)" },
];

export function AfoCastPanel() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const cast = afo.cast ?? defaultAfoCast();
    const reliefs = afo.reliefs ?? defaultAfoReliefs();
    const setMethod = useDesignStore((s) => s.setMethod);
    const sourceMesh = useAfoStore((s) => s.sourceMesh);
    const castMesh = useAfoStore((s) => s.castMesh);
    const setPlacingClinical = useAfoStore((s) => s.setPlacingClinicalId);
    const placingClinical = useAfoStore((s) => s.placingClinicalId);
    const warnings = evaluateAfoWarnings(afo, castMesh ?? sourceMesh);

    const patchCast = (partial: Partial<typeof cast>) => {
        patchAfoState({ cast: { ...cast, ...partial } }, "afo-cast");
        refreshAfoWorkingMesh();
    };

    return (
        <div className="space-y-3 text-xs">
            <section className="space-y-2 rounded-md border border-border bg-background/40 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Production method
                </div>
                <div className="flex flex-col gap-1">
                    {METHODS.map((m) => (
                        <label key={m.id} className="flex items-center gap-2">
                            <input
                                type="radio"
                                name="afo-method"
                                checked={afo.method === m.id}
                                onChange={() => {
                                    patchAfoState({ method: m.id }, "afo-method");
                                    setMethod(m.id);
                                }}
                            />
                            {m.label}
                        </label>
                    ))}
                </div>
            </section>

            <SliderField
                label="Remove Cast"
                value={cast.removeCastMm}
                min={AFO_REMOVE_CAST_RANGE[0]}
                max={AFO_REMOVE_CAST_RANGE[1]}
                unit="mm"
                defaultValue={0}
                onChange={(v) => patchCast({ removeCastMm: v })}
            />
            <SliderField
                label="Shin offset"
                value={cast.shinOffsetMm}
                min={AFO_SHIN_OFFSET_RANGE[0]}
                max={AFO_SHIN_OFFSET_RANGE[1]}
                unit="mm"
                defaultValue={0}
                onChange={(v) => patchCast({ shinOffsetMm: v })}
            />
            <p className="text-[10px] text-muted-foreground">
                Effective feather {afo.effectiveFeatherMm.toFixed(1)} mm (auto-widen, |∇c| ≤ 0.7)
            </p>
            <label className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={cast.insensate}
                    onChange={(e) => patchCast({ insensate: e.target.checked })}
                />
                Insensate (no shrink, all reliefs on)
            </label>
            <label className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={cast.flattenBottom}
                    onChange={(e) => patchCast({ flattenBottom: e.target.checked })}
                />
                Flatten bottom
            </label>
            <label className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={cast.shinBox.enabled}
                    onChange={(e) => patchCast({ shinBox: { ...cast.shinBox, enabled: e.target.checked } })}
                />
                Shin box
            </label>
            {cast.shinBox.enabled ? (
                <SliderField
                    label="Shin height"
                    value={cast.shinBox.heightMm}
                    min={80}
                    max={350}
                    unit="mm"
                    onChange={(v) => patchCast({ shinBox: { ...cast.shinBox, heightMm: v } })}
                />
            ) : null}
            <label className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={cast.toeBox.enabled}
                    onChange={(e) => patchCast({ toeBox: { ...cast.toeBox, enabled: e.target.checked } })}
                />
                Toe box
            </label>
            {cast.toeBox.enabled ? (
                <SliderField
                    label="Toe box height"
                    value={cast.toeBox.heightPct ?? 100}
                    min={AFO_TOE_BOX_PCT_RANGE[0]}
                    max={AFO_TOE_BOX_PCT_RANGE[1]}
                    unit="%"
                    defaultValue={100}
                    onChange={(v) => patchCast({ toeBox: { ...cast.toeBox, heightPct: v } })}
                />
            ) : null}

            <section className="space-y-2 rounded-md border border-border bg-background/40 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Bony reliefs
                </div>
                {(
                    [
                        ["malleoli", "Malleoli"] as const,
                        ["navicular", "Navicular"] as const,
                        ["fifthMetBase", "5th met base"] as const,
                        ["postCalcaneus", "Post calcaneus"] as const,
                        ["fibularHead", "Fibular head"] as const,
                    ] as const
                ).map(([key, label]) => {
                    const ch = reliefs[key];
                    return (
                        <div key={key} className="space-y-1">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={ch.on}
                                    onChange={(e) => {
                                        patchAfoState(
                                            {
                                                reliefs: {
                                                    ...reliefs,
                                                    [key]: { ...ch, on: e.target.checked },
                                                },
                                            },
                                            "afo-relief",
                                        );
                                        refreshAfoWorkingMesh();
                                    }}
                                />
                                {label} {ch.on ? "on" : "off"}
                            </label>
                            {ch.on ? (
                                <SliderField
                                    label={`${label} depth`}
                                    value={ch.mm}
                                    min={AFO_RELIEF_RANGE[0]}
                                    max={AFO_RELIEF_RANGE[1]}
                                    unit="mm"
                                    onChange={(v) => {
                                        patchAfoState(
                                            { reliefs: { ...reliefs, [key]: { ...ch, mm: v } } },
                                            "afo-relief",
                                        );
                                        refreshAfoWorkingMesh();
                                    }}
                                />
                            ) : null}
                        </div>
                    );
                })}
            </section>

            <section className="space-y-1 rounded-md border border-border bg-background/40 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Crest / extra markers
                </div>
                <p className="text-[10px] text-muted-foreground">
                    Crest {afo.crest.lowConfidence ? "low confidence" : "ok"} · outliers{" "}
                    {(afo.crest.outlierRatio * 100).toFixed(0)}%{afo.crest.override ? " · override" : ""}
                </p>
                {AFO_CLINICAL_MARKERS.map((m) => {
                    const placed = afo.clinicalMarkers.some((c) => c.id === m.id);
                    return (
                        <button
                            key={m.id}
                            type="button"
                            className="h-7 w-full rounded border border-border text-left text-[11px]"
                            onClick={() => setPlacingClinical(placingClinical === m.id ? null : m.id)}
                        >
                            {placed ? "✓" : placingClinical === m.id ? "…" : "○"} {m.label}
                        </button>
                    );
                })}
            </section>

            <div className="space-y-1 rounded-md border border-border bg-background/40 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Display
                </div>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={cast.transparent}
                        onChange={(e) => {
                            patchCast({ transparent: e.target.checked });
                            useDesignStore.getState().setViewer({ transparent: e.target.checked });
                        }}
                    />
                    Transparent
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={cast.show3dModel}
                        onChange={(e) => patchCast({ show3dModel: e.target.checked })}
                    />
                    3D model
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={cast.showCorrected}
                        onChange={(e) => patchCast({ showCorrected: e.target.checked })}
                    />
                    Corrected
                </label>
            </div>

            {warnings.map((w) => (
                <p
                    key={w.id}
                    className={w.blocking ? "text-[11px] text-amber-100" : "text-[11px] text-amber-200/90"}
                >
                    {w.blocking ? "Block: " : "Warn: "}
                    {w.message}
                </p>
            ))}
        </div>
    );
}
