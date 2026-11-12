// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import { defaultAfoDesignState } from "./defaults";
import {
    AFO_SHELL_EXPORT_KINDS,
    afoBlockedShellExports,
    afoMeshIdentity,
    afoShellIsCurrent,
    beginShellGeneration,
    commitShellIfCurrent,
    currentAfoShellFingerprint,
} from "./shell-fingerprint";
import type { AfoTriMesh } from "./types";

function pin(x: number) {
    return { point: { x, y: 0, z: 0 }, vertexIndex: 0 };
}

function fakeMesh(x = 0): AfoTriMesh {
    return {
        positions: new Float32Array([x, 0, 0, x + 1, 0, 0, x, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
    };
}

function loadTrim(trimX: number, shellReady: boolean) {
    useAfoStore.getState().resetSession();
    useDesignStore.setState({
        design: {
            ...defaultDesign(),
            productType: "afo",
            method: "printing_shell",
            afo: {
                ...defaultAfoDesignState("left"),
                trimPoints: [pin(0), pin(trimX), pin(20)],
                trimCurve: [
                    { x: 0, y: 0, z: 0 },
                    { x: trimX, y: 0, z: 0 },
                    { x: 20, y: 0, z: 0 },
                ],
                trimClosed: true,
                trimConfirmed: true,
                shellReady,
            },
        },
        history: [],
        future: [],
    });
}

describe("AFO shell input fingerprint", () => {
    test("shellReady alone does not keep a shell built from other trim points", () => {
        loadTrim(10, true);
        expect(afoShellIsCurrent()).toBe(false);
        const fingerprint = currentAfoShellFingerprint();
        useAfoStore.getState().commitShell(fakeMesh(), fingerprint);
        expect(getAfoState().shellReady).toBe(true);
        expect(afoShellIsCurrent()).toBe(true);
        expect(afoBlockedShellExports()).toEqual([]);

        useDesignStore.getState().checkpoint("trim");
        const current = getAfoState();
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                afo: {
                    ...current,
                    trimPoints: [pin(0), pin(14), pin(20)],
                    trimCurve: [
                        { x: 0, y: 0, z: 0 },
                        { x: 14, y: 0, z: 0 },
                        { x: 20, y: 0, z: 0 },
                    ],
                    shellReady: true,
                },
            },
        });
        expect(getAfoState().shellReady).toBe(true);
        expect(afoShellIsCurrent()).toBe(false);
        expect(afoBlockedShellExports()).toEqual([...AFO_SHELL_EXPORT_KINDS]);

        useDesignStore.getState().undo();
        expect(getAfoState().trimPoints[1]?.point.x).toBe(10);
        expect(afoShellIsCurrent()).toBe(true);
        expect(afoBlockedShellExports()).toEqual([]);

        useDesignStore.getState().redo();
        expect(getAfoState().trimPoints[1]?.point.x).toBe(14);
        expect(getAfoState().shellReady).toBe(true);
        expect(afoShellIsCurrent()).toBe(false);
        expect(afoBlockedShellExports()).toEqual(["stl", "3mf", "gcode", "vertexslice"]);
    });

    test("a shell that finishes after the inputs changed is discarded", () => {
        loadTrim(10, false);
        const startedFingerprint = currentAfoShellFingerprint();
        const token = beginShellGeneration();
        patchAfoState({ trimPoints: [pin(0), pin(18), pin(20)] }, "trim-while-shell");
        expect(
            commitShellIfCurrent({
                startedFingerprint,
                startedToken: token,
                shell: fakeMesh(3),
            }),
        ).toBe("stale");
        expect(useAfoStore.getState().shellMesh).toBeNull();
        expect(useAfoStore.getState().shellFingerprint).toBeNull();
        expect(getAfoState().shellReady).toBe(false);

        const newer = beginShellGeneration();
        beginShellGeneration();
        expect(
            commitShellIfCurrent({
                startedFingerprint: currentAfoShellFingerprint(),
                startedToken: newer,
                shell: fakeMesh(4),
            }),
        ).toBe("stale");
        expect(useAfoStore.getState().shellMesh).toBeNull();

        const live = beginShellGeneration();
        const fp = currentAfoShellFingerprint();
        expect(commitShellIfCurrent({ startedFingerprint: fp, startedToken: live, shell: fakeMesh(5) })).toBe(
            "ok",
        );
        expect(useAfoStore.getState().shellFingerprint).toBe(fp);
        expect(getAfoState().shellReady).toBe(true);
        expect(afoShellIsCurrent()).toBe(true);
    });

    test("cast identity, corrections, print, flatten, and flat-AFO settings each change the hash", () => {
        loadTrim(10, false);
        const base = currentAfoShellFingerprint();
        useAfoStore.getState().setCastMesh(fakeMesh(0));
        const withCast = currentAfoShellFingerprint();
        expect(withCast).not.toBe(base);
        useAfoStore.getState().setCastMesh(fakeMesh(8));
        expect(currentAfoShellFingerprint()).not.toBe(withCast);
        expect(afoMeshIdentity(fakeMesh(0))).not.toBe(afoMeshIdentity(fakeMesh(8)));
        const same = fakeMesh(1);
        expect(afoMeshIdentity(same)).toBe(afoMeshIdentity(same));

        const beforePrint = currentAfoShellFingerprint();
        const print = getAfoState().print;
        patchAfoState({ print: { ...print, thicknessMm: print.thicknessMm + 0.4 } }, "thickness");
        expect(currentAfoShellFingerprint()).not.toBe(beforePrint);

        const beforeEdge = currentAfoShellFingerprint();
        patchAfoState(
            { print: { ...getAfoState().print, edgeMm: getAfoState().print.edgeMm + 0.2 } },
            "edge",
        );
        expect(currentAfoShellFingerprint()).not.toBe(beforeEdge);

        const beforeFlatten = currentAfoShellFingerprint();
        patchAfoState(
            { cast: { ...getAfoState().cast, flattenBottom: true, flattenRemoveMm: 5 } },
            "flatten",
        );
        expect(currentAfoShellFingerprint()).not.toBe(beforeFlatten);

        const beforeCorrection = currentAfoShellFingerprint();
        patchAfoState(
            {
                corrections: {
                    ...getAfoState().corrections,
                    heelLiftMm: 3,
                    left: { ...getAfoState().corrections.left, heelLiftMm: 3 },
                },
            },
            "correction",
        );
        expect(currentAfoShellFingerprint()).not.toBe(beforeCorrection);

        const beforeFlat = currentAfoShellFingerprint();
        patchAfoState({ flatAfo: { revision: 1, values: { unwrap: true } } }, "flat-afo");
        expect(getAfoState().flatAfo).toEqual({ revision: 1, values: { unwrap: true } });
        expect(currentAfoShellFingerprint()).not.toBe(beforeFlat);
    });
});
