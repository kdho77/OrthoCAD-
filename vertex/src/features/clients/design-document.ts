// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Map server design.get documents into editor DesignState.

import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import type { DesignState, ElementKind, PlacedElement, Side, SideCorrections, Unit } from "@/types";
import { readStoredDesignSettings } from "../../../shared/design-settings";

interface CorrectionRow {
    side: Side;
    forefootPostingDeg: number;
    rearfootPostingDeg: number;
    medialSkiveMm: number;
    lateralSkiveMm: number;
    archFillMm: number;
    archHeightMm: number;
    heelCupDepthMm: number;
    heelCupHeightMm: number;
    apexMoveMm: number;
    medialFlangeMm: number;
    lateralFlangeMm: number;
}

interface ElementRow {
    id: string;
    side: Side;
    kind: string;
    posX: number;
    posY: number;
    rotationDeg: number;
    scaleX: number;
    scaleY: number;
    heightMm: number;
}

export interface DesignDocument {
    id: string;
    pattern: DesignState["pattern"];
    method: DesignState["method"];
    thicknessMm: number;
    linked: boolean;
    unit: Unit;
    createdAt: string;
    updatedAt: string;
    corrections?: CorrectionRow[];
    elements?: ElementRow[];
    /** Versioned parameter snapshot. Absent on designs saved before this column. */
    settingsJson?: unknown;
}

function sideCorrectionFromRow(row: CorrectionRow): SideCorrections {
    const base = defaultDesign().corrections.left;
    return {
        ...base,
        forefootPostingDeg: row.forefootPostingDeg,
        rearfootPostingDeg: row.rearfootPostingDeg,
        medialSkiveMm: row.medialSkiveMm,
        lateralSkiveMm: row.lateralSkiveMm,
        archFillMm: row.archFillMm,
        archHeightMm: row.archHeightMm,
        heelCupDepthMm: row.heelCupDepthMm,
        heelCupHeightMm: row.heelCupHeightMm,
        apexMoveMm: row.apexMoveMm,
        medialFlangeMm: row.medialFlangeMm,
        lateralFlangeMm: row.lateralFlangeMm,
    };
}

function correctionSide(rows: CorrectionRow[] | undefined, side: Side): SideCorrections {
    const row = rows?.find((entry) => entry.side === side);
    return row ? sideCorrectionFromRow(row) : defaultDesign().corrections.left;
}

function elementFromRow(row: ElementRow): PlacedElement {
    return {
        id: row.id,
        kind: row.kind as ElementKind,
        side: row.side,
        position: { x: row.posX, y: row.posY },
        rotationDeg: row.rotationDeg,
        scale: { x: row.scaleX, y: row.scaleY },
        heightMm: row.heightMm,
    };
}

/** True when the server has stored geometry beyond a freshly created design row. */
export function hasPersistedGeometry(doc: DesignDocument | null | undefined): boolean {
    if (!doc) return false;
    if (readStoredDesignSettings(doc.settingsJson)) return true;
    if ((doc.elements?.length ?? 0) > 0) return true;
    if ((doc.corrections?.length ?? 0) > 0) return true;
    return doc.updatedAt !== doc.createdAt;
}

export function designStateFromDocument(doc: DesignDocument): DesignState {
    const stored = readStoredDesignSettings(doc.settingsJson);
    if (stored) return stored as unknown as DesignState;
    const left = correctionSide(doc.corrections, "left");
    const right = correctionSide(doc.corrections, "right");
    const elements = (doc.elements ?? []).map(elementFromRow);
    return createDesignWithStockPlaceholder({
        ...defaultDesign(),
        pattern: doc.pattern,
        method: doc.method,
        thicknessMm: doc.thicknessMm,
        corrections: {
            unit: doc.unit,
            linked: doc.linked,
            left,
            right: doc.linked ? left : right,
        },
        elements,
    });
}

export function asDesignDocument(raw: unknown): DesignDocument | null {
    if (!raw || typeof raw !== "object") return null;
    const doc = raw as DesignDocument;
    if (typeof doc.id !== "string") return null;
    return doc;
}
