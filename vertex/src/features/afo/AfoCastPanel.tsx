// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { SliderField } from "@/components/ui/slider-field";
import { applyCastOps } from "@/lib/geometry/afo/cast";
import { defaultAfoCast } from "@/lib/geometry/afo/defaults";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
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
    const setMethod = useDesignStore((s) => s.setMethod);
    const setCastMesh = useAfoStore((s) => s.setCastMesh);
    const sourceMesh = useAfoStore((s) => s.sourceMesh);
    const castMesh = useAfoStore((s) => s.castMesh);

    const patchCast = (partial: Partial<typeof cast>) => {
        const next = { ...cast, ...partial };
        patchAfoState({ cast: next }, "afo-cast");
        const src = sourceMesh ?? castMesh;
        if (src) setCastMesh(applyCastOps(src, next));
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

            <label className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={cast.removeCast}
                    onChange={(e) => patchCast({ removeCast: e.target.checked })}
                />
                Remove Cast
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
        </div>
    );
}
