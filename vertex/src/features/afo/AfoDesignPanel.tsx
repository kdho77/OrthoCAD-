// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AFO_DESIGN_MARKERS } from "@/lib/geometry/afo/defaults";
import { validateTrimLoop } from "@/lib/geometry/afo/trim-loop";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

export function AfoDesignPanel() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const placingIndex = useAfoStore((s) => s.placingLandmarkIndex);
    const setPlacing = useAfoStore((s) => s.setPlacingLandmarkIndex);
    const setPlacingTrim = useAfoStore((s) => s.setPlacingTrim);
    const placingTrim = useAfoStore((s) => s.placingTrim);
    const correctedMesh = useAfoStore((s) => s.correctedMesh);
    const castMesh = useAfoStore((s) => s.castMesh);
    const working = correctedMesh ?? castMesh;

    const nextMarker = AFO_DESIGN_MARKERS[Math.min(placingIndex, AFO_DESIGN_MARKERS.length - 1)];
    const landmarksDone = afo.landmarks.length >= AFO_DESIGN_MARKERS.length;
    const validation = working
        ? validateTrimLoop(
              working,
              afo.trimPoints.map((p) => p.vertexIndex),
              afo.trimClosed,
          )
        : { ok: false, reasons: ["No working mesh."] };

    return (
        <div className="space-y-3 text-xs">
            <section className="space-y-1 rounded-md border border-border bg-background/40 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    5 landmarks
                </div>
                <ol className="space-y-1">
                    {AFO_DESIGN_MARKERS.map((m, i) => {
                        const placed = afo.landmarks.some((l) => l.id === m.id);
                        return (
                            <li key={m.id} className="flex items-center justify-between">
                                <span>
                                    {i + 1}. {m.label}
                                </span>
                                <span className={placed ? "text-emerald-300" : "text-muted-foreground"}>
                                    {placed ? "placed" : i === placingIndex ? "next" : ""}
                                </span>
                            </li>
                        );
                    })}
                </ol>
                {!landmarksDone && nextMarker ? (
                    <p className="text-muted-foreground">
                        Click the mesh to place{" "}
                        <strong className="text-foreground">{nextMarker.label}</strong>. View auto-rotates.
                    </p>
                ) : (
                    <button
                        type="button"
                        className="h-7 w-full rounded border border-border text-[11px]"
                        onClick={() => setPlacing(0)}
                    >
                        Re-place landmarks
                    </button>
                )}
            </section>

            <section className="space-y-2 rounded-md border border-border bg-background/40 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Geodesic trim
                </div>
                <p className="text-muted-foreground">
                    Click to place. Close by clicking the first point. Drag handles to edit.
                </p>
                <button
                    type="button"
                    className="h-8 w-full rounded-md border border-border bg-background"
                    onClick={() => setPlacingTrim(!placingTrim)}
                >
                    {placingTrim ? "Placing trim…" : "Start trim line"}
                </button>
                <p className="text-[10px] text-muted-foreground">
                    {afo.trimPoints.length} handles · {afo.trimClosed ? "closed" : "open"}
                </p>
                {!validation.ok
                    ? validation.reasons.map((r) => (
                          <p key={r} className="text-[10px] text-amber-200">
                              {r}
                          </p>
                      ))
                    : null}
                <button
                    type="button"
                    disabled={afo.trimPoints.length < 3 || afo.trimClosed}
                    className="h-8 w-full rounded-md border border-border bg-background"
                    onClick={() => patchAfoState({ trimClosed: true }, "afo-trim-close")}
                >
                    Close loop
                </button>
                <button
                    type="button"
                    disabled={!validation.ok}
                    className="h-8 w-full rounded-md bg-primary text-[12px] font-medium text-primary-foreground disabled:opacity-40"
                    onClick={() => patchAfoState({ trimConfirmed: true }, "afo-trim-confirm")}
                >
                    Confirm
                </button>
            </section>

            <p className="rounded-md border border-dashed border-border px-2 py-2 text-[10px] text-muted-foreground">
                Cut out, hole pattern, corrugation, add pad and add volume are deferred.
            </p>
        </div>
    );
}
