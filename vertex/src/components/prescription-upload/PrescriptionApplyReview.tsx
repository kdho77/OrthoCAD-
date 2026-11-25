// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    clampScalarField,
    scalarFieldMeta,
    WEDGE_FIELD_META,
    type WedgeFieldKey,
} from "@/features/corrections/correction-field-meta";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import type { PrescriptionParseResult, Side, SideCorrections, WedgeCorrection } from "@/types";
import {
    buildPrescriptionToApply,
    correctionRowKeys,
    countIncluded,
    initialReviewDraft,
    patchesAsymmetric,
} from "./prescription-review-logic";

type WedgeEdge = "medial" | "lateral";
type WedgeUnit = "deg" | "mm";

interface PrescriptionApplyReviewProps {
    result: PrescriptionParseResult;
    onApply: (edited: PrescriptionParseResult) => void;
    onCancel: () => void;
}

function clampWedge(
    wedge: WedgeCorrection | { side: WedgeEdge; value?: number; unit?: WedgeUnit },
    maxDeg: number,
    maxMm: number,
): WedgeCorrection {
    const unit = wedge.unit ?? "deg";
    const value = wedge.value ?? 0;
    const max = unit === "deg" ? maxDeg : maxMm;
    return {
        side: wedge.side,
        unit,
        value: Math.min(max, Math.max(0, value)),
    };
}

function wedgeMax(meta: (typeof WEDGE_FIELD_META)[number], unit: WedgeUnit): number {
    return unit === "deg" ? meta.maxDeg : meta.maxMm;
}

function MotionTogglePair<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
}: {
    options: { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
}) {
    return (
        <fieldset className="m-0 grid grid-cols-2 gap-0.5 border-0 p-0">
            <legend className="sr-only">{ariaLabel}</legend>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={cn(
                        "rounded border px-0.5 py-0.5 text-center text-[9px]",
                        value === option.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground",
                    )}
                >
                    {option.label}
                </button>
            ))}
        </fieldset>
    );
}

function WedgeCell({
    wedgeKey,
    wedge,
    onChange,
}: {
    wedgeKey: WedgeFieldKey;
    wedge: WedgeCorrection | { side: WedgeEdge; value?: number; unit?: WedgeUnit } | undefined;
    onChange: (next: WedgeCorrection | undefined) => void;
}) {
    const meta = WEDGE_FIELD_META.find((w) => w.key === wedgeKey)!;
    const activeEdge = wedge?.side ?? "lateral";
    const activeUnit = wedge?.unit ?? "deg";
    const activeValue = wedge?.value ?? 0;
    const max = wedgeMax(meta, activeUnit);

    const commit = (
        edge: WedgeEdge,
        value: number,
        unit: WedgeUnit,
    ) => {
        if (value <= 0) {
            onChange(undefined);
            return;
        }
        onChange(clampWedge({ side: edge, value, unit }, meta.maxDeg, meta.maxMm));
    };

    return (
        <div className="space-y-1">
            <MotionTogglePair
                ariaLabel={`${meta.label} edge`}
                options={[
                    { value: "lateral", label: "Lat high" },
                    { value: "medial", label: "Med high" },
                ]}
                value={activeEdge}
                onChange={(edge) => commit(edge, activeValue, activeUnit)}
            />
            <input
                type="number"
                className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs tabular-nums"
                min={0}
                max={max}
                step={0.5}
                value={activeValue}
                onChange={(e) => {
                    const parsed = Number(e.target.value);
                    if (!Number.isFinite(parsed)) return;
                    commit(activeEdge, parsed, activeUnit);
                }}
            />
            <MotionTogglePair
                ariaLabel={`${meta.label} unit`}
                options={[
                    { value: "deg", label: "deg" },
                    { value: "mm", label: "mm" },
                ]}
                value={activeUnit}
                onChange={(unit) =>
                    commit(activeEdge, Math.min(activeValue, wedgeMax(meta, unit)), unit)
                }
            />
        </div>
    );
}

function ScalarCell({
    fieldKey,
    value,
    onChange,
}: {
    fieldKey: keyof SideCorrections;
    value: number | undefined;
    onChange: (next: number | undefined) => void;
}) {
    const meta = scalarFieldMeta(fieldKey);
    if (!meta) return <span className="text-muted-foreground">—</span>;
    const display = value ?? "";
    return (
        <input
            type="number"
            className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs tabular-nums"
            min={meta.min}
            max={meta.max}
            step={0.5}
            value={display}
            onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                    onChange(undefined);
                    return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) return;
                onChange(clampScalarField(fieldKey, parsed));
            }}
        />
    );
}

function rowLabel(key: string): string {
    const wedge = WEDGE_FIELD_META.find((w) => w.key === key);
    if (wedge) return wedge.label;
    const scalar = scalarFieldMeta(key as keyof SideCorrections);
    return scalar?.label ?? key;
}

function isWedgeKey(key: string): key is WedgeFieldKey {
    return key === "rearfootWedge" || key === "forefootWedge" || key === "fullLengthWedge";
}

export function PrescriptionApplyReview({ result, onApply, onCancel }: PrescriptionApplyReviewProps) {
    const linked = useDesignStore((s) => s.design.corrections.linked);
    const [{ left, right, included }, setDraft] = useState(() => initialReviewDraft(result));

    const keys = useMemo(() => correctionRowKeys(left, right), [left, right]);
    const includedCount = countIncluded(keys, included);
    const someExcluded = includedCount < keys.length;
    const asymmetric = patchesAsymmetric(left, right, keys, included);
    const needsUnlink = linked && asymmetric;

    const patchSide = (side: Side, key: string, value: unknown) => {
        setDraft((draft) => {
            const nextSide = { ...draft[side] };
            if (value === undefined) delete (nextSide as Record<string, unknown>)[key];
            else (nextSide as Record<string, unknown>)[key] = value;
            return { ...draft, [side]: nextSide };
        });
    };

    const toggleIncluded = (key: string, on: boolean) => {
        setDraft((draft) => ({ ...draft, included: { ...draft.included, [key]: on } }));
    };

    const apply = (all: boolean) => {
        const effectiveIncluded = { ...included };
        if (all) {
            for (const key of keys) effectiveIncluded[key] = true;
        }
        const payload = buildPrescriptionToApply(result, left, right, effectiveIncluded);
        onApply(payload);
    };

    return (
        <div className="flex flex-col gap-2">
            <MetaBadges result={result} />
            {needsUnlink ? (
                <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-700">
                    Left and right values differ while L+R are linked. Applying will switch this design to
                    Independent feet so one-sided corrections are not mirrored.
                </p>
            ) : null}
            <p className="text-xs font-medium">
                Apply all {includedCount} correction{includedCount === 1 ? "" : "s"}?
            </p>
            <ReviewCorrectionsTable
                keys={keys}
                left={left}
                right={right}
                included={included}
                patchSide={patchSide}
                toggleIncluded={toggleIncluded}
            />
            <ElementsNote result={result} />
            {result.notes ? <p className="text-[10px] text-muted-foreground">{result.notes}</p> : null}
            <div className="flex flex-wrap gap-2">
                <Button type="button" className="flex-1" disabled={includedCount === 0} onClick={() => apply(true)}>
                    Apply all ({includedCount})
                </Button>
                {someExcluded ? (
                    <Button
                        type="button"
                        variant="secondary"
                        className="flex-1"
                        disabled={includedCount === 0}
                        onClick={() => apply(false)}
                    >
                        Apply selected ({includedCount})
                    </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}

function ReviewCorrectionsTable({
    keys,
    left,
    right,
    included,
    patchSide,
    toggleIncluded,
}: {
    keys: string[];
    left: Partial<SideCorrections>;
    right: Partial<SideCorrections>;
    included: Record<string, boolean>;
    patchSide: (side: Side, key: string, value: unknown) => void;
    toggleIncluded: (key: string, on: boolean) => void;
}) {
    if (keys.length === 0) return <p className="text-muted-foreground">No scalar corrections parsed.</p>;
    return (
        <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[10px]">
                <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="px-1 py-1 font-medium">Incl.</th>
                        <th className="px-1 py-1 font-medium">Field</th>
                        <th className="px-1 py-1 font-medium">Left</th>
                        <th className="px-1 py-1 font-medium">Right</th>
                    </tr>
                </thead>
                <tbody>
                    {keys.map((key) => (
                        <tr key={key} className="border-b border-border/60 align-top">
                            <td className="px-1 py-1">
                                <input
                                    type="checkbox"
                                    checked={included[key] !== false}
                                    aria-label={`Include ${rowLabel(key)}`}
                                    onChange={(e) => toggleIncluded(key, e.target.checked)}
                                />
                            </td>
                            <td className="px-1 py-1 font-medium">{rowLabel(key)}</td>
                            {(["left", "right"] as Side[]).map((side) => {
                                const patch = side === "left" ? left : right;
                                const value = (patch as Record<string, unknown>)[key];
                                return (
                                    <td key={side} className="px-1 py-1 min-w-[7rem]">
                                        {isWedgeKey(key) ? (
                                            <WedgeCell
                                                wedgeKey={key}
                                                wedge={value as WedgeCorrection | undefined}
                                                onChange={(next) => patchSide(side, key, next)}
                                            />
                                        ) : (
                                            <ScalarCell
                                                fieldKey={key as keyof SideCorrections}
                                                value={typeof value === "number" ? value : undefined}
                                                onChange={(next) => patchSide(side, key, next)}
                                            />
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ElementsNote({ result }: { result: PrescriptionParseResult }) {
    if (result.elements.length === 0) return null;
    return (
        <div className="rounded border border-border bg-muted/30 p-2">
            <div className="mb-1 text-[10px] font-semibold uppercase text-primary/80">Suggested elements</div>
            <p className="mb-1 text-[10px] text-muted-foreground">
                Not applied automatically — add these from the Elements library if needed.
            </p>
            <div className="flex flex-wrap gap-1">
                {result.elements.map((e, i) => (
                    <span key={`${e.kind}-${e.side}-${i}`} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        {e.kind} ({e.side})
                    </span>
                ))}
            </div>
        </div>
    );
}

function MetaBadges({ result }: { result: PrescriptionParseResult }) {
    return (
        <div className="flex flex-wrap gap-2 text-[11px]">
            <Badge label={`provider: ${result.provider}`} />
            <Badge label={`confidence: ${(result.confidence * 100).toFixed(0)}%`} />
            {result.tokenCost ? <Badge label={`-${result.tokenCost} tokens`} /> : null}
            {result.pattern ? <Badge label={`pattern: ${result.pattern}`} /> : null}
            {result.method ? <Badge label={`method: ${result.method}`} /> : null}
        </div>
    );
}

function Badge({ label }: { label: string }) {
    return <span className={cn("rounded bg-muted px-1.5 py-0.5 text-[11px]")}>{label}</span>;
}