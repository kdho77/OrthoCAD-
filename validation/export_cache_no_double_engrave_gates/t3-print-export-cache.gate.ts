// Frozen gate T3. Do not edit after the freeze commit.
// Print -> Export keeps printLoftEpoch and the cached solid.
// Print -> Corrections -> Print still invalidates.
// With a matching cached solid, the Export viewer must not call the wall loft again.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, rs, test } from "@rstest/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BufferGeometry } from "three";
import { useBaseInsoleGeometry } from "@/hooks/useBaseInsoleGeometry";
import { baseModifierField, getDesignBase } from "@/lib/geometry/base-asset";
import { elementsForSurface } from "@/lib/geometry/element-assets/display-mesh";
import { resolveLiveBottomPattern } from "@/lib/geometry/procedural-wall/live-bottom-pattern";
import {
    peekManufacturingSolid,
    publishPreviewManufacturingSolid,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { manufacturingCacheContext } from "@/lib/geometry/procedural-wall/manufacturing-solid-context";
import { resetPreviewLoftQueueForTests } from "@/lib/geometry/procedural-wall/preview-loft-queue";
import { autoPatternKey } from "@/lib/geometry/procedural-wall/preview-loft-ui";
import * as loftWorker from "@/lib/geometry/procedural-wall/preview-loft-worker";
import * as printCompose from "@/lib/geometry/procedural-wall/print-solid-compose";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { resolveViewerWallStyle } from "@/lib/geometry/procedural-wall/viewer-wall-flag";
import { shoeWidthForSide } from "@/lib/geometry/shoe-width";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { resolveActiveTrimline, useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import type { DesignState, Side } from "@/types";
import { check, triangleGeometry } from "./support";

const SAMPLE_TOP = resolve("vertex/public/Templates/SAMPLE_Top.glb");

beforeEach(() => {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    resetPreviewLoftQueueForTests();
    usePreviewLoftStatusStore.getState().reset();
    useClinicalWorkflowStore.setState({
        productType: "insole",
        step: "elements",
        designStartPath: null,
        completedSteps: [],
    });
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ bottomPatternEdit: null, trimlineEdit: null });
});

describe("T3 Print to Export keeps the cached solid", () => {
    test("T3-export Print to Export does not bump printLoftEpoch or drop the cache", () => {
        const geo = triangleGeometry();
        geo.userData = { mark: "print-solid" };
        rememberManufacturingSolid("print-solid", "left", geo);
        useClinicalWorkflowStore.setState({ step: "print" });
        usePreviewLoftStatusStore.setState({
            phaseBySide: { left: "ready", right: "ready" },
            printLoftEpoch: 5,
        });

        useClinicalWorkflowStore.getState().setStep("export");
        const afterSet = usePreviewLoftStatusStore.getState();
        const cached = peekManufacturingSolid("print-solid", "left");
        const setOk =
            afterSet.printLoftEpoch === 5 &&
            afterSet.phaseBySide.left === "ready" &&
            afterSet.phaseBySide.right === "ready" &&
            cached?.userData.mark === "print-solid";

        useClinicalWorkflowStore.setState({ step: "print" });
        useClinicalWorkflowStore.getState().goNext();
        const afterNext = usePreviewLoftStatusStore.getState();
        const nextCached = peekManufacturingSolid("print-solid", "left");
        const nextOk =
            useClinicalWorkflowStore.getState().step === "export" &&
            afterNext.printLoftEpoch === 5 &&
            nextCached?.userData.mark === "print-solid";

        check({
            id: "T3-export",
            rule: "TESTS-3: Print -> Export preserves the cached solid and does not bump printLoftEpoch",
            expectOnBase: "pass",
            pass: setOk && nextOk,
            measured: `setEpoch=${afterSet.printLoftEpoch} nextEpoch=${afterNext.printLoftEpoch} setCache=${cached?.userData.mark ?? "missing"} nextCache=${nextCached?.userData.mark ?? "missing"}`,
            threshold: "epoch stays 5 and cache mark stays print-solid for setStep and goNext",
        });
        geo.dispose();
        cached?.dispose();
        nextCached?.dispose();
    });

    test("T3-corrections Print to Corrections to Print drops the cache and bumps the epoch once", () => {
        const geo = triangleGeometry();
        rememberManufacturingSolid("print-solid", "left", geo);
        useClinicalWorkflowStore.setState({ step: "print" });
        usePreviewLoftStatusStore.setState({
            phaseBySide: { left: "ready", right: "ready" },
            printLoftEpoch: 5,
        });

        useClinicalWorkflowStore.getState().setStep("corrections");
        const epoch = usePreviewLoftStatusStore.getState().printLoftEpoch;
        const dropped = peekManufacturingSolid("print-solid", "left") === null;
        const phases = usePreviewLoftStatusStore.getState().phaseBySide;

        useClinicalWorkflowStore.getState().setStep("print");
        const epochAfterReturn = usePreviewLoftStatusStore.getState().printLoftEpoch;

        check({
            id: "T3-corrections",
            rule: "TESTS-3: Print -> Corrections -> Print invalidates once and does not bump again on return",
            expectOnBase: "pass",
            pass:
                epoch === 6 &&
                dropped &&
                phases.left === "idle" &&
                phases.right === "idle" &&
                epochAfterReturn === 6,
            measured: `epoch=${epoch} dropped=${dropped} returnEpoch=${epochAfterReturn} phases=${phases.left}/${phases.right}`,
            threshold: "epoch=6 dropped=true phases=idle/idle returnEpoch=6",
        });
        geo.dispose();
    });

    test("T3-viewer Export does not reconstruct when the print solid is cached", async () => {
        const bytes = readFileSync(SAMPLE_TOP);
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        primeSampleTopGeometry(await sampleTopFromArrayBuffer(copy));

        useDesignStore.setState({
            design: { ...createDesignWithStockPlaceholder(), method: "printing_solid" },
            viewer: {
                ...useDesignStore.getState().viewer,
                wallModel: "procedural",
                wallStyle: "round",
                deviceType: "functional",
                showLeft: true,
                showRight: true,
            },
            stockBaseLoading: false,
            stockBaseResolutionState: "resolved",
        });
        useClinicalWorkflowStore.setState({ step: "export", designStartPath: null });
        usePreviewLoftStatusStore.setState({ printLoftEpoch: 0, cancelled: false });

        const design = useDesignStore.getState().design;
        const side: Side = "left";
        const base = getDesignBase(design, side);
        const thickness = design.paired?.leftThicknessMm ?? design.thicknessMm;
        const field = baseModifierField(design, side, thickness);
        field.elements = elementsForSurface(field.elements ?? [], true);
        const viewer = useDesignStore.getState().viewer;
        const heelW = field.corrections?.heelCupWidthMm ?? 0;
        const widthId = shoeWidthForSide(design, side);
        const patternKey = `${autoPatternKey(Boolean(base?.mirrored), design.pattern)}:hw${heelW.toFixed(2)}:w${widthId}`;
        useBottomPatternStore.getState().ensureGenerated(side, patternKey, [
            { x: 0, y: 0, z: 0 },
            { x: 20, y: -5, z: 0 },
            { x: 40, y: 0, z: 0 },
        ]);
        const livePts = resolveLiveBottomPattern({
            draft: null,
            stored: useBottomPatternStore.getState().getPattern(side),
            trim: resolveActiveTrimline(side),
        });
        const solidOptions = printSolidOptions({
            design,
            side,
            field,
            viewer: {
                wallStyle: resolveViewerWallStyle(viewer.wallStyle),
                deviceType: viewer.deviceType ?? "functional",
                lateralFlangeHeightMm: viewer.lateralFlangeHeightMm ?? 0,
                lateralFlangeLengthMm: viewer.lateralFlangeLengthMm ?? 40,
                lateralFlangeAngleDeg: viewer.lateralFlangeAngleDeg ?? 10,
            },
            trimline: resolveActiveTrimline(side),
            bottomPattern: livePts,
        });
        const cacheCtx = {
            ...manufacturingCacheContext({
                design,
                side,
                baseAssetId: base?.assetId ?? "",
                mirrored: Boolean(base?.mirrored),
            }),
            printLoftEpoch: usePreviewLoftStatusStore.getState().printLoftEpoch,
        };
        const geo = new BufferGeometry();
        geo.userData = { mark: "print-solid" };
        publishPreviewManufacturingSolid(solidOptions, cacheCtx, geo);

        const reconstructSpy = rs
            .spyOn(loftWorker, "reconstructProceduralPreviewInWorker")
            .mockRejectedValue(new Error("GATE_RECONSTRUCT"));
        const patternSpy = rs.spyOn(loftWorker, "buildProceduralViewerPatternInWorker").mockResolvedValue([]);
        const composeSpy = rs
            .spyOn(printCompose, "composeViewerPrintSolidTop")
            .mockResolvedValue(new BufferGeometry());

        const probe: { geometry: BufferGeometry | null } = { geometry: null };
        function Probe(props: { design: DesignState }) {
            const state = useBaseInsoleGeometry(props.design, side);
            probe.geometry = state.geometry;
            return null;
        }

        const container = document.createElement("div");
        document.body.appendChild(container);
        let root: Root | null = null;
        try {
            await act(async () => {
                root = createRoot(container);
                root.render(createElement(Probe, { design }));
            });
            let phase = usePreviewLoftStatusStore.getState().phaseBySide.left;
            for (let i = 0; i < 40 && phase !== "ready" && phase !== "error"; i++) {
                await act(async () => {
                    await new Promise((r) => setTimeout(r, 50));
                });
                phase = usePreviewLoftStatusStore.getState().phaseBySide.left;
            }
            const calls = reconstructSpy.mock.calls.length;
            const mark = probe.geometry?.userData?.mark ?? "";
            check({
                id: "T3-viewer",
                rule: "ONE / TESTS-3: Export reuses the cached print solid and does not run the wall loft",
                expectOnBase: "fail",
                pass: calls === 0 && phase === "ready" && mark === "print-solid",
                measured: `reconstructCalls=${calls} phase=${phase} mark=${mark || "none"}`,
                threshold: "reconstructCalls=0 phase=ready mark=print-solid",
            });
        } finally {
            await act(async () => {
                root?.unmount();
            });
            container.remove();
            reconstructSpy.mockRestore();
            patternSpy.mockRestore();
            composeSpy.mockRestore();
            geo.dispose();
        }
    });
});
