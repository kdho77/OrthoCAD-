// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SliderField } from "@/components/ui/slider-field";
import {
    defaultTextMarking,
    isSideText,
    TEXT_ANCHOR_U,
    TEXT_CNC_TOOL_MM,
    TEXT_MAX_CHARS,
    TEXT_WALL_FEATURE_MIN_MM,
    unsupportedTextChars,
} from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import {
    evaluateTextFit,
    type TextFitFix,
    type TextFitReport,
    usableAlong,
} from "@/lib/geometry/text-marking/fit";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import type { TextGuideStation } from "@/lib/geometry/text-marking/place";
import { textControlBounds } from "@/lib/geometry/text-marking/validate";
import { cn } from "@/lib/utils";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import type { TextAnchor, TextMode, TextSurface } from "@/types";
import { publishTextFitAlert, useTextGuides } from "./text-guide-store";

const FIX_LABEL: Record<TextFitFix, string> = {
    shrink: "Shrink to fit",
    bottom: "Move to Bottom",
    shorten: "Shorten",
};

let fontPromise: ReturnType<typeof loadTextFont> | null = null;
function fontOnce() {
    fontPromise ??= loadTextFont();
    return fontPromise;
}

function FootMark({ active }: { active: TextSurface }) {
    const on = (zone: TextSurface) => (active === zone ? "#7c3aed" : "currentColor");
    return (
        <svg width="22" height="28" viewBox="0 0 22 28" aria-hidden className="shrink-0">
            <title>Foot</title>
            <path
                d="M11 2c2 2 3 4 3 7 0 2-1 3-1 5 2 1 4 3 4 6 0 3-2 6-6 6s-6-3-6-6c0-3 2-5 4-6 0-2-1-3-1-5 0-3 1-5 3-7z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
            />
            <path d="M7 16c-1 2-1 5 0 8" stroke={on("wall")} strokeWidth={active === "wall" ? 2.4 : 1} />
            <path d="M15 16c1 2 1 5 0 8" stroke={on("medial")} strokeWidth={active === "medial" ? 2.4 : 1} />
            <ellipse
                cx="11"
                cy="22"
                rx="3"
                ry="2"
                fill={active === "bottom" ? "#7c3aed" : "none"}
                stroke={on("bottom")}
            />
        </svg>
    );
}

function stationsFor(surface: TextSurface, lateral: TextGuideStation[], medial: TextGuideStation[]) {
    if (surface === "medial") return medial;
    if (surface === "wall") return lateral;
    return lateral.length ? lateral : medial;
}

export function useTextFitReport(): TextFitReport & {
    advanceMm: number;
    fitLengthMm: number;
    usableMm: number;
} {
    const marking = useDesignStore((s) => s.design.textMarking) ?? defaultTextMarking();
    const setTextMarking = useDesignStore((s) => s.setTextMarking);
    const method = useDesignStore((s) => s.design.method);
    const guides = useTextGuides();
    const guide = guides.right ?? guides.left;
    const [metrics, setMetrics] = useState({ advanceMm: 0, strokeMm: 0.9 });
    const raw = marking.differentOnLR ? `${marking.textLeft}${marking.textRight}` : marking.text;

    useEffect(() => {
        const text = (marking.differentOnLR ? marking.textRight || marking.textLeft : marking.text).trim();
        if (!text) {
            setMetrics({ advanceMm: 0, strokeMm: 0.9 });
            return;
        }
        let cancel = false;
        const timer = window.setTimeout(() => {
            void fontOnce().then((font) => {
                if (cancel) return;
                try {
                    const flat = flattenText(
                        font,
                        text.toUpperCase().slice(0, TEXT_MAX_CHARS),
                        marking.capHeightMm,
                        marking.letterSpacingMm,
                        true,
                        true,
                    );
                    setMetrics({ advanceMm: flat.advanceMm, strokeMm: flat.minStrokeMm });
                } catch {
                    setMetrics({ advanceMm: text.length * marking.capHeightMm * 0.7, strokeMm: 0.4 });
                }
            });
        }, 40);
        return () => {
            cancel = true;
            window.clearTimeout(timer);
        };
    }, [
        marking.capHeightMm,
        marking.differentOnLR,
        marking.letterSpacingMm,
        marking.text,
        marking.textLeft,
        marking.textRight,
    ]);

    const along = useMemo(() => {
        const stations = guide ? stationsFor(marking.surface, guide.lateral, guide.medial) : [];
        if (!isSideText(marking.surface)) {
            const length = guide ? Math.max(0, guide.maxX - guide.minX - 8) : 0;
            return { usableMm: 99, fitLengthMm: length, thickMm: 99 };
        }
        return usableAlong(stations, marking.capHeightMm);
    }, [guide, marking.capHeightMm, marking.surface]);

    const report = useMemo(
        () =>
            evaluateTextFit({
                surface: marking.surface,
                capMm: marking.capHeightMm,
                depthMm: marking.mode === "emboss" ? marking.heightMm : marking.depthMm,
                advanceMm: metrics.advanceMm,
                strokeMm: metrics.strokeMm,
                usableMm: along.usableMm,
                fitLengthMm: along.fitLengthMm,
                thickMm: along.thickMm,
                toolDiameterMm: method === "milling_3axis" ? TEXT_CNC_TOOL_MM : null,
                unsupported: unsupportedTextChars(raw),
            }),
        [along, marking, method, metrics, raw],
    );

    useEffect(() => {
        publishTextFitAlert(report.warnings.length > 0);
    }, [report.warnings.length]);

    useEffect(() => {
        if (report.clampedDepthMm == null || marking.mode !== "engrave" || !isSideText(marking.surface))
            return;
        if (Math.abs(marking.depthMm - report.clampedDepthMm) < 0.05) return;
        setTextMarking({ depthMm: report.clampedDepthMm });
    }, [marking.depthMm, marking.mode, marking.surface, report.clampedDepthMm, setTextMarking]);

    return {
        ...report,
        advanceMm: metrics.advanceMm,
        fitLengthMm: along.fitLengthMm,
        usableMm: along.usableMm,
    };
}

export function TextFitList() {
    const marking = useDesignStore((s) => s.design.textMarking);
    const setTextMarking = useDesignStore((s) => s.setTextMarking);
    const report = useTextFitReport();
    if (!marking) return null;

    const applyFix = (fix: TextFitFix) => {
        if (fix === "bottom") {
            const next = defaultTextMarking("bottom");
            setTextMarking({
                surface: "bottom",
                capHeightMm: next.capHeightMm,
                depthMm: next.depthMm,
                heightMm: next.heightMm,
                placementU: next.placementU,
                anchor: "arch",
                mode: marking.mode,
                rotationDeg: 0,
                nudgeAlongMm: 0,
                nudgeAcrossMm: 0,
            });
            return;
        }
        if (fix === "shorten") {
            const ratio = report.advanceMm > 0 ? report.fitLengthMm / report.advanceMm : 1;
            const source = marking.differentOnLR ? marking.textRight || marking.text : marking.text;
            const n = Math.max(1, Math.floor(source.length * ratio) - 1);
            setTextMarking(
                marking.differentOnLR ? { textRight: source.slice(0, n) } : { text: source.slice(0, n) },
            );
            return;
        }
        const bounds = textControlBounds(marking.surface);
        let cap = marking.capHeightMm;
        if (report.fitLengthMm > 0 && report.advanceMm > report.fitLengthMm) {
            cap *= report.fitLengthMm / report.advanceMm;
        }
        if (isSideText(marking.surface) && report.usableMm > 0 && report.usableMm < cap) {
            cap = report.usableMm;
        }
        cap = Math.min(bounds.capMax, Math.max(bounds.capMin, Math.round(cap * 10) / 10));
        setTextMarking({ capHeightMm: cap });
    };

    const fixes = [...new Set(report.warnings.flatMap((w) => w.fixes))];
    if (!report.warnings.length && !report.notes.length) return null;
    return (
        <div className="mt-2 space-y-1" aria-live="polite">
            {report.notes.map((note) => (
                <p key={note} className="text-[11px] leading-snug text-amber-200">
                    {note}
                </p>
            ))}
            {report.warnings.map((w) => (
                <p key={w.id} className="text-[11px] leading-snug text-amber-200">
                    {w.message}
                </p>
            ))}
            {fixes.length ? (
                <div className="flex flex-wrap gap-1 pt-1">
                    {fixes.map((fix) => (
                        <button
                            key={fix}
                            type="button"
                            className="rounded border border-amber-400/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-100"
                            onClick={() => applyFix(fix)}
                        >
                            {FIX_LABEL[fix]}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

const SURFACES: Array<{ id: TextSurface; label: string }> = [
    { id: "bottom", label: "Bottom" },
    { id: "wall", label: "Outer side" },
    { id: "medial", label: "Inner side" },
];

export function TextMarkingPanel() {
    const marking = useDesignStore((s) => s.design.textMarking) ?? defaultTextMarking();
    const setTextMarking = useDesignStore((s) => s.setTextMarking);
    const placementFoot = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
    const bounds = useMemo(() => textControlBounds(marking.surface), [marking.surface]);
    const side = isSideText(marking.surface);
    const bottomFace = marking.surface === "bottom";
    const offsetLabel = marking.mode === "emboss" ? "Emboss height" : "Engrave depth";
    const offsetValue = marking.mode === "emboss" ? marking.heightMm : marking.depthMm;

    useEffect(() => {
        if (marking.surface === "bottom" && marking.mode === "emboss") {
            setTextMarking({ mode: "engrave" });
        }
    }, [marking.surface, marking.mode, setTextMarking]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            if (el?.closest("input, textarea, select")) return;
            const step = e.shiftKey ? 5 : 1;
            if (e.key === "ArrowLeft") setTextMarking({ nudgeAlongMm: marking.nudgeAlongMm - step });
            else if (e.key === "ArrowRight") setTextMarking({ nudgeAlongMm: marking.nudgeAlongMm + step });
            else if (e.key === "ArrowUp") setTextMarking({ nudgeAcrossMm: marking.nudgeAcrossMm + step });
            else if (e.key === "ArrowDown") setTextMarking({ nudgeAcrossMm: marking.nudgeAcrossMm - step });
            else return;
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [marking.nudgeAcrossMm, marking.nudgeAlongMm, setTextMarking]);

    const onSurface = (surface: TextSurface) => {
        const next = defaultTextMarking(surface);
        setTextMarking({
            surface,
            capHeightMm: next.capHeightMm,
            depthMm: next.depthMm,
            heightMm: next.heightMm,
            placementU: next.placementU,
            anchor: surface === "bottom" ? "arch" : marking.anchor,
            rotationDeg: surface === "bottom" ? marking.rotationDeg : 0,
            nudgeAlongMm: 0,
            nudgeAcrossMm: 0,
            feet: placementFoot === "left" || placementFoot === "right" ? placementFoot : marking.feet,
        });
    };

    const setAnchor = (anchor: TextAnchor) => {
        setTextMarking({ anchor, placementU: TEXT_ANCHOR_U[anchor], nudgeAlongMm: 0 });
    };

    const field = marking.differentOnLR ? (placementFoot === "left" ? "textLeft" : "textRight") : "text";
    const value = marking.differentOnLR
        ? placementFoot === "left"
            ? marking.textLeft
            : marking.textRight
        : marking.text;
    const unsupported = unsupportedTextChars(value);

    return (
        <div className="space-y-2 rounded-md border border-border bg-background/40 p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Text
            </div>
            <Input
                value={value}
                maxLength={TEXT_MAX_CHARS}
                placeholder="Name or mark (max 24)"
                aria-label="Insole text"
                className="h-8 text-xs"
                onChange={(e) => setTextMarking({ [field]: e.target.value })}
            />
            {unsupported ? (
                <p className="text-[11px] text-amber-200" aria-live="polite">
                    {unsupported} isn’t supported. Use A–Z, 0–9, and . , - &apos; /.
                </p>
            ) : null}
            <div className="flex flex-wrap gap-1">
                <button
                    type="button"
                    aria-pressed={marking.differentOnLR}
                    className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        marking.differentOnLR
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border text-muted-foreground",
                    )}
                    onClick={() =>
                        setTextMarking({
                            differentOnLR: !marking.differentOnLR,
                            textLeft: marking.textLeft || marking.text,
                            textRight: marking.textRight || marking.text,
                        })
                    }
                >
                    Different on L and R
                </button>
                <button
                    type="button"
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                    onClick={() => {
                        const base = (marking.text || "MARK").replace(/ [LR]$/, "");
                        setTextMarking({
                            differentOnLR: true,
                            textLeft: `${base} L`.slice(0, TEXT_MAX_CHARS),
                            textRight: `${base} R`.slice(0, TEXT_MAX_CHARS),
                            text: base,
                        });
                    }}
                >
                    Add L/R mark
                </button>
            </div>
            {marking.differentOnLR && placementFoot === "both" ? (
                <div className="grid grid-cols-2 gap-1">
                    <Input
                        aria-label="Left text"
                        value={marking.textLeft}
                        maxLength={TEXT_MAX_CHARS}
                        className="h-8 text-xs"
                        onChange={(e) => setTextMarking({ textLeft: e.target.value })}
                    />
                    <Input
                        aria-label="Right text"
                        value={marking.textRight}
                        maxLength={TEXT_MAX_CHARS}
                        className="h-8 text-xs"
                        onChange={(e) => setTextMarking({ textRight: e.target.value })}
                    />
                </div>
            ) : null}
            <fieldset className="flex gap-1 border-0 p-0" aria-label="Engrave or emboss">
                {(bottomFace ? (["engrave"] as TextMode[]) : (["engrave", "emboss"] as TextMode[])).map(
                    (m) => (
                        <button
                            key={m}
                            type="button"
                            aria-pressed={marking.mode === m}
                            onClick={() => setTextMarking({ mode: m })}
                            className={cn(
                                "h-7 flex-1 rounded-md border text-[11px] capitalize",
                                marking.mode === m
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border text-muted-foreground",
                            )}
                        >
                            {m === "engrave" ? "Engraved" : "Embossed"}
                        </button>
                    ),
                )}
            </fieldset>
            <fieldset className="flex items-stretch gap-1 border-0 p-0" aria-label="Text placement">
                <FootMark active={marking.surface} />
                {SURFACES.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        aria-pressed={marking.surface === s.id}
                        onClick={() => onSurface(s.id)}
                        className={cn(
                            "h-8 flex-1 rounded-md border text-[10px]",
                            marking.surface === s.id
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground",
                        )}
                    >
                        {s.label}
                    </button>
                ))}
            </fieldset>
            {marking.surface === "bottom" ? (
                <fieldset className="flex gap-1 border-0 p-0" aria-label="Bottom anchor">
                    {(["heel", "arch", "forefoot"] as TextAnchor[]).map((a) => (
                        <button
                            key={a}
                            type="button"
                            aria-pressed={marking.anchor === a}
                            onClick={() => setAnchor(a)}
                            className={cn(
                                "h-7 flex-1 rounded-md border text-[10px] capitalize",
                                marking.anchor === a
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border text-muted-foreground",
                            )}
                        >
                            {a}
                        </button>
                    ))}
                </fieldset>
            ) : (
                <p className="text-[10px] text-muted-foreground">
                    Snaps to the wall mid-height. Drag along the side.
                </p>
            )}
            <SliderField
                label="Letter height"
                value={marking.capHeightMm}
                min={bounds.capMin}
                max={bounds.capMax}
                step={0.1}
                unit="mm"
                defaultValue={bounds.capDefault}
                onChange={(v) => setTextMarking({ capHeightMm: v })}
                onReset={() => setTextMarking({ capHeightMm: bounds.capDefault })}
            />
            <SliderField
                label={offsetLabel}
                value={offsetValue}
                min={marking.mode === "emboss" ? bounds.heightMin : bounds.depthMin}
                max={marking.mode === "emboss" ? bounds.heightMax : bounds.depthMax}
                step={0.1}
                unit="mm"
                defaultValue={marking.mode === "emboss" ? bounds.heightDefault : bounds.depthDefault}
                onChange={(v) => setTextMarking(marking.mode === "emboss" ? { heightMm: v } : { depthMm: v })}
                onReset={() =>
                    setTextMarking(
                        marking.mode === "emboss"
                            ? { heightMm: bounds.heightDefault }
                            : { depthMm: bounds.depthDefault },
                    )
                }
            />
            {marking.surface === "bottom" ? (
                <SliderField
                    label="Rotation"
                    value={marking.rotationDeg}
                    min={-90}
                    max={90}
                    step={1}
                    unit="°"
                    defaultValue={0}
                    onChange={(v) => setTextMarking({ rotationDeg: v })}
                    onReset={() => setTextMarking({ rotationDeg: 0 })}
                />
            ) : null}
            <div className="flex flex-wrap gap-1">
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px]"
                    onClick={() => setTextMarking({ nudgeAlongMm: marking.nudgeAlongMm - 1 })}
                >
                    Nudge back
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px]"
                    onClick={() => setTextMarking({ nudgeAlongMm: marking.nudgeAlongMm + 1 })}
                >
                    Nudge forward
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px]"
                    onClick={() => setTextMarking({ nudgeAcrossMm: marking.nudgeAcrossMm + 1 })}
                >
                    Nudge out
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px]"
                    onClick={() =>
                        setTextMarking({
                            nudgeAlongMm: 0,
                            nudgeAcrossMm: 0,
                            rotationDeg: 0,
                            placementU: bounds.uDefault,
                            anchor: marking.surface === "bottom" ? "arch" : marking.anchor,
                        })
                    }
                >
                    Reset position
                </Button>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
                One bold sans. Arrow keys nudge. Editing L / R / Both mirrors the placement, not the letters.
                {side && marking.capHeightMm + 1e-6 < TEXT_WALL_FEATURE_MIN_MM
                    ? " Side letters under 5 mm are shown but not cut."
                    : ""}
            </p>
            <TextFitList />
        </div>
    );
}
