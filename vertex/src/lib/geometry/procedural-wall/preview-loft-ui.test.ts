// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    autoPatternKey,
    PRINT_LOFT_HINT,
    PRINT_LOFT_TIMEOUT_MS,
    previewLoftProgressLabel,
    printLoftProgress01,
    printLoftSteps,
    proceduralLoftReuseKey,
    resolveLoftActiveSide,
    shouldLoftProceduralViewer,
    viewerLoftOverlayState,
    wantsProceduralExportSolid,
} from "./preview-loft-ui";

const idle = { left: "idle", right: "idle" } as const;
const loading = { left: false, right: false };

describe("preview loft overlay", () => {
    test("resolveLoftActiveSide follows the only visible foot", () => {
        expect(resolveLoftActiveSide(true, false, "right")).toBe("left");
        expect(resolveLoftActiveSide(false, true, "left")).toBe("right");
        expect(resolveLoftActiveSide(true, true, "right")).toBe("right");
    });

    test("full splash stays up while any visible foot is still lofting", () => {
        const blocked = viewerLoftOverlayState({
            showBase: true,
            showLeft: true,
            showRight: true,
            stockBaseLoading: false,
            loadingBySide: { left: true, right: true },
            phaseBySide: { left: "lofting", right: "queued" },
            error: null,
        });
        expect(blocked.blockViewport).toBe(true);
        expect(blocked.kind).toBe("progress");

        const oneReady = viewerLoftOverlayState({
            showBase: true,
            showLeft: true,
            showRight: true,
            stockBaseLoading: false,
            loadingBySide: { left: false, right: true },
            phaseBySide: { left: "ready", right: "lofting" },
            error: null,
        });
        expect(oneReady.blockViewport).toBe(true);
        expect(oneReady.showBanner).toBe(true);
        expect(oneReady.kind).toBe("progress");
        expect(PRINT_LOFT_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
        expect(PRINT_LOFT_HINT).toMatch(/minute per foot/i);
        expect(printLoftSteps({ left: "lofting", right: "queued" }).map((s) => s.state)).toEqual([
            "active",
            "active",
            "active",
        ]);
        expect(printLoftProgress01(15_000, 1)).toBeGreaterThan(0.1);
        expect(printLoftProgress01(15_000, 1)).toBeLessThan(0.95);
    });

    test("surfaces an error with a blocking overlay when no foot is ready", () => {
        const state = viewerLoftOverlayState({
            showBase: true,
            showLeft: true,
            showRight: true,
            stockBaseLoading: false,
            loadingBySide: loading,
            phaseBySide: { left: "error", right: "idle" },
            error: "SAMPLE_Top.glb missing",
        });
        expect(state.blockViewport).toBe(true);
        expect(state.kind).toBe("error");
    });

    test("progress label names the foot being lofted", () => {
        expect(previewLoftProgressLabel({ left: "lofting", right: "queued" }, false)).toBe(
            "Building left walls for print…",
        );
        expect(previewLoftProgressLabel({ left: "ready", right: "fetching" }, false)).toBe(
            "Loading top surface…",
        );
    });

    test("viewer lofts only on the Print step", () => {
        expect(shouldLoftProceduralViewer("scan", "procedural")).toBe(false);
        expect(shouldLoftProceduralViewer("base", "procedural")).toBe(false);
        expect(shouldLoftProceduralViewer("corrections", "procedural")).toBe(false);
        expect(shouldLoftProceduralViewer("print", "procedural")).toBe(true);
        expect(shouldLoftProceduralViewer("print", "legacy")).toBe(false);
    });

    test("export lofts SAMPLE_Top and never Default.glb", () => {
        expect(
            wantsProceduralExportSolid({ assetId: "sample-top", glbPath: "Templates/SAMPLE_Top.glb" }),
        ).toBe(true);
        expect(
            wantsProceduralExportSolid({ assetId: "stock-default", glbPath: "Templates/Default.glb" }),
        ).toBe(false);
    });

    test("reuse key stays stable for the auto-generated faired pattern", () => {
        const a = proceduralLoftReuseKey({
            side: "left",
            wallStyle: "straight",
            deviceType: "functional",
            thicknessMm: 3,
            correctionsJson: "{}",
            scanPattern: "full_contact",
            patternKind: "auto",
            patternHash: autoPatternKey(false, "full_contact"),
            flanges: "0:40:10",
        });
        const b = proceduralLoftReuseKey({
            side: "left",
            wallStyle: "straight",
            deviceType: "functional",
            thicknessMm: 3,
            correctionsJson: "{}",
            scanPattern: "full_contact",
            patternKind: "auto",
            patternHash: autoPatternKey(false, "full_contact"),
            flanges: "0:40:10",
        });
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        const c = proceduralLoftReuseKey({
            side: "left",
            wallStyle: "straight",
            deviceType: "functional",
            thicknessMm: 3,
            correctionsJson: "{}",
            scanPattern: "full_contact",
            patternKind: "auto",
            patternHash: autoPatternKey(false, "full_contact"),
            flanges: "0:40:10",
            shoeWidth: "wide",
            elementsJson: "[{}]",
        });
        expect(c).not.toBe(a);
        expect(idle.left).toBe("idle");
    });
});
