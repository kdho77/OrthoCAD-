// Independent UI grader for PR #456 (cursor/ai-rx-review-apply-1125). Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PrescriptionApplyReview } from "@/components/prescription-upload/PrescriptionApplyReview";
import {
    CORRECTION_SCALAR_FIELDS,
    scalarFieldMeta,
    WEDGE_FIELD_META,
} from "@/features/corrections/correction-field-meta";
import { useDesignStore } from "@/stores/design-store";
import type { PrescriptionParseResult } from "@/types";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** Files touched by PR #456 @ 8a9e88ee (scope gate G8). */
const PR456_CHANGED_FILES = [
    "ci/unit-test-shards.json",
    "vertex/.env.example",
    "vertex/server/src/lib/ai-provider.test.ts",
    "vertex/server/src/lib/ai-provider.ts",
    "vertex/src/components/prescription-upload/PrescriptionApplyReview.tsx",
    "vertex/src/components/prescription-upload/PrescriptionUpload.test.tsx",
    "vertex/src/components/prescription-upload/PrescriptionUpload.tsx",
    "vertex/src/components/prescription-upload/prescription-review-logic.ts",
    "vertex/src/features/clinical/SetupAiGenerateButton.tsx",
    "vertex/src/features/clinical/ai-generate-from-text.ts",
    "vertex/src/features/corrections/CorrectionsPanel.tsx",
    "vertex/src/features/corrections/correction-field-meta.ts",
    "vertex/src/stores/design-store.ts",
] as const;

function baseResult(overrides?: Partial<PrescriptionParseResult>): PrescriptionParseResult {
    return {
        corrections: {},
        elements: [],
        notes: "",
        confidence: 1,
        provider: "heuristic",
        tokenCost: 0,
        ...overrides,
    };
}

function setInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function correctionsSnapshot() {
    const c = useDesignStore.getState().design.corrections;
    return JSON.parse(JSON.stringify({ linked: c.linked, left: c.left, right: c.right }));
}

describe("PR #456 grader G1 — defer apply until explicit confirm", () => {
    let container: HTMLDivElement;
    let root: Root;
    let applyCount: number;
    let cancelled: boolean;

    beforeEach(() => {
        applyCount = 0;
        cancelled = false;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    test("G1: mount and Cancel never call onApply; store unchanged", async () => {
        const before = correctionsSnapshot();
        const result = baseResult({
            corrections: { left: { heelLiftMm: 5 }, right: { heelLiftMm: 5 } },
        });
        await act(async () =>
            root.render(
                createElement(PrescriptionApplyReview, {
                    result,
                    onApply: () => {
                        applyCount += 1;
                    },
                    onCancel: () => {
                        cancelled = true;
                    },
                }),
            ),
        );
        expect(applyCount).toBe(0);
        const cancelBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
        expect(cancelBtn).toBeTruthy();
        await act(async () => cancelBtn?.click());
        expect(cancelled).toBe(true);
        expect(applyCount).toBe(0);
        expect(correctionsSnapshot()).toEqual(before);
    });
});

function resetDesignCorrections(linked: boolean) {
    const base = useDesignStore.getState().design;
    useDesignStore.setState({
        design: {
            ...base,
            corrections: {
                ...base.corrections,
                linked,
                left: { ...base.corrections.left, heelLiftMm: 0, fullLengthWedge: undefined },
                right: { ...base.corrections.right, heelLiftMm: 0, fullLengthWedge: undefined },
            },
        },
    });
}

describe("PR #456 grader G2 — edited values land in design store", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        resetDesignCorrections(false);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    test("G2: review UI edit then applyPrescription preserves 4.5° medial full-length right", async () => {
        const result = baseResult({
            corrections: {
                left: {},
                right: { fullLengthWedge: { side: "lateral", value: 2, unit: "deg" } },
            },
        });
        await act(async () =>
            root.render(
                createElement(PrescriptionApplyReview, {
                    result,
                    onApply: (edited) => {
                        useDesignStore.getState().applyPrescription(edited);
                    },
                    onCancel: () => {},
                }),
            ),
        );
        const wedgeRow = [...container.querySelectorAll("tr")].find((tr) =>
            tr.textContent?.includes("Full-length"),
        );
        expect(wedgeRow).toBeTruthy();
        const rightCell = wedgeRow!.querySelectorAll("td")[3];
        const medHigh = [...rightCell.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Med high"),
        );
        expect(medHigh).toBeTruthy();
        await act(async () => {
            medHigh?.click();
        });
        const wedgeInput = rightCell.querySelector('input[type="number"]') as HTMLInputElement;
        setInputValue(wedgeInput, "4.5");
        const applyAll = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Apply all"),
        );
        await act(async () => applyAll?.click());
        const right = useDesignStore.getState().design.corrections.right.fullLengthWedge;
        expect(right?.side).toBe("medial");
        expect(right?.value).toBe(4.5);
        expect(right?.unit).toBe("deg");
    });

    test("G2: 4.5° medial full-length wedge right only", () => {
        useDesignStore.getState().applyPrescription(
            baseResult({
                corrections: {
                    left: {},
                    right: {
                        fullLengthWedge: { side: "medial", value: 4.5, unit: "deg" },
                    },
                },
            }),
        );
        const right = useDesignStore.getState().design.corrections.right.fullLengthWedge;
        expect(right).toEqual({ side: "medial", value: 4.5, unit: "deg" });
        expect(useDesignStore.getState().design.corrections.left.fullLengthWedge).toBeUndefined();
    });
});

describe("PR #456 grader G3 — Apply selected omits unchecked rows", () => {
    let container: HTMLDivElement;
    let root: Root;
    let applied: PrescriptionParseResult | null;

    beforeEach(() => {
        applied = null;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    test("G3: unchecked arch height excluded from payload", async () => {
        const result = baseResult({
            corrections: {
                left: { heelLiftMm: 2, archHeightMm: 8 },
                right: { heelLiftMm: 2, archHeightMm: 8 },
            },
        });
        await act(async () =>
            root.render(
                createElement(PrescriptionApplyReview, {
                    result,
                    onApply: (edited) => {
                        applied = edited;
                    },
                    onCancel: () => {},
                }),
            ),
        );
        const archCheckbox = container.querySelector(
            'input[aria-label="Include Arch height"]',
        ) as HTMLInputElement;
        await act(async () => {
            archCheckbox.click();
        });
        const applySelected = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Apply selected"),
        );
        await act(async () => applySelected?.click());
        expect(applied?.corrections.left).toEqual({ heelLiftMm: 2 });
        expect(applied?.corrections.right).toEqual({ heelLiftMm: 2 });
    });
});

describe("PR #456 grader G4 — left-only heel lift does not mirror when unlinked", () => {
    test("G4: 6.35 mm left-only unlinks; right stays 0", () => {
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                corrections: {
                    ...useDesignStore.getState().design.corrections,
                    linked: true,
                    right: { ...useDesignStore.getState().design.corrections.right, heelLiftMm: 0 },
                },
            },
        });
        useDesignStore.getState().applyPrescription(
            baseResult({ corrections: { left: { heelLiftMm: 6.35 } } }),
        );
        const { linked, left, right } = useDesignStore.getState().design.corrections;
        expect(linked).toBe(false);
        expect(left.heelLiftMm).toBe(6.35);
        expect(right.heelLiftMm).toBe(0);
    });
});

describe("PR #456 grader G5 — review inputs use shared correction-field-meta", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    test("G5: scalar and wedge min/max match shared constants", async () => {
        const heelMeta = scalarFieldMeta("heelLiftMm")!;
        const wedgeMeta = WEDGE_FIELD_META.find((w) => w.key === "fullLengthWedge")!;
        const result = baseResult({
            corrections: {
                left: { heelLiftMm: 1 },
                right: { fullLengthWedge: { side: "lateral", value: 2, unit: "deg" } },
            },
        });
        await act(async () =>
            root.render(
                createElement(PrescriptionApplyReview, {
                    result,
                    onApply: () => {},
                    onCancel: () => {},
                }),
            ),
        );
        const heelRow = [...container.querySelectorAll("tr")].find((tr) =>
            tr.textContent?.includes("Heel lift"),
        );
        expect(heelRow).toBeTruthy();
        const scalarInput = heelRow!.querySelector('input[type="number"]') as HTMLInputElement;
        expect(Number(scalarInput.getAttribute("min"))).toBe(heelMeta.min);
        expect(Number(scalarInput.getAttribute("max"))).toBe(heelMeta.max);
        const wedgeRow = [...container.querySelectorAll("tr")].find((tr) =>
            tr.textContent?.includes("Full-length"),
        );
        const wedgeInput = wedgeRow!.querySelector('input[type="number"]') as HTMLInputElement;
        expect(Number(wedgeInput.getAttribute("max"))).toBe(wedgeMeta.maxDeg);

        const panelSource = readFileSync(
            join(REPO_ROOT, "vertex/src/features/corrections/CorrectionsPanel.tsx"),
            "utf8",
        );
        expect(panelSource).toContain("CORRECTION_SCALAR_FIELDS");
        expect(CORRECTION_SCALAR_FIELDS.find((f) => f.key === "heelLiftMm")?.max).toBe(heelMeta.max);
    });
});

describe("PR #456 grader G6 — SetupAiGenerateButton uses review, no direct apply", () => {
    test("G6: component wires PrescriptionApplyReview; legacy auto-apply removed", () => {
        const source = readFileSync(
            join(REPO_ROOT, "vertex/src/features/clinical/SetupAiGenerateButton.tsx"),
            "utf8",
        );
        expect(source).toContain("PrescriptionApplyReview");
        expect(source).toContain("applyReviewedPrescriptionToCurrentDesign");
        expect(source).toContain("parseAiPrescriptionText");
        expect(source).not.toContain("applyAiGenerateToCurrentDesign");
        const aiText = readFileSync(join(REPO_ROOT, "vertex/src/features/clinical/ai-generate-from-text.ts"), "utf8");
        expect(aiText).toContain("parseAiPrescriptionText");
        expect(aiText).toContain("applyReviewedPrescriptionToCurrentDesign");
        expect(aiText).not.toContain("applyAiGenerateToCurrentDesign");
    });
});

describe("PR #456 grader G8 — PR scope excludes geometry/loft/slicer/export", () => {
    const forbidden =
        /(^tests\/|\/geometry\/|procedural-wall|\/loft|slicer|\/export|vertexslice|print-solid|gcode)/i;

    test("G8: changed file list has no forbidden paths", () => {
        for (const file of PR456_CHANGED_FILES) {
            expect(file).not.toMatch(forbidden);
        }
        expect(PR456_CHANGED_FILES.length).toBe(13);
    });
});