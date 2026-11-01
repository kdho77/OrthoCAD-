// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useSyncExternalStore } from "react";
import type { TextGuide } from "@/lib/geometry/text-marking/place";
import type { Side } from "@/types";

const guides: Partial<Record<Side, TextGuide>> = {};
const fitErrors: Partial<Record<Side, string | null>> = {};
let dragU: number | null = null;
let fitAlert = false;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

export function publishTextGuide(side: Side, guide: TextGuide, fitError?: string | null): void {
    guides[side] = guide;
    fitErrors[side] = fitError ?? null;
    emit();
}

export function textGuideSnapshot(): Partial<Record<Side, TextGuide>> {
    return guides;
}

export function textFitErrorSnapshot(): Partial<Record<Side, string | null>> {
    return fitErrors;
}

export function setTextDragU(u: number | null): void {
    dragU = u;
    emit();
}

export function textDragU(): number | null {
    return dragU;
}

export function publishTextFitAlert(on: boolean): void {
    if (fitAlert === on) return;
    fitAlert = on;
    emit();
}

export function textFitAlert(): boolean {
    return fitAlert;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useTextGuides(): Partial<Record<Side, TextGuide>> {
    return useSyncExternalStore(subscribe, textGuideSnapshot, textGuideSnapshot);
}

export function useTextDragU(): number | null {
    return useSyncExternalStore(subscribe, textDragU, textDragU);
}

export function useTextFitAlert(): boolean {
    return useSyncExternalStore(subscribe, textFitAlert, textFitAlert);
}

export function useTextFitErrors(): Partial<Record<Side, string | null>> {
    return useSyncExternalStore(subscribe, textFitErrorSnapshot, textFitErrorSnapshot);
}
