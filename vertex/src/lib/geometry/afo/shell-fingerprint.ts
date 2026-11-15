// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { sha256Hex } from "@/lib/geometry/procedural-wall/sha256";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";
import type { AfoDesignState, AfoTriMesh } from "./types";

/** STL, 3MF, G-code, and the VertexSlice send all use this gate. */
export const AFO_SHELL_EXPORT_KINDS = ["stl", "3mf", "gcode", "vertexslice"] as const;
export type AfoShellExportKind = (typeof AFO_SHELL_EXPORT_KINDS)[number];

let shellGeneration = 0;

/** Start one shell build. A later start makes this token stale. */
export function beginShellGeneration(): number {
    shellGeneration += 1;
    return shellGeneration;
}

export function currentShellGeneration(): number {
    return shellGeneration;
}

const meshIdentityCache = new WeakMap<AfoTriMesh, string>();

function mix(h: number, v: number): number {
    return Math.imul(h ^ v, 0x01000193);
}

/** Stable identity of a cast or corrected mesh. Cached per mesh object. */
export function afoMeshIdentity(mesh: AfoTriMesh | null | undefined): string {
    if (!mesh) return "none";
    const cached = meshIdentityCache.get(mesh);
    if (cached) return cached;
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5 ^ 0x9e3779b9;
    const positions = mesh.positions;
    for (let i = 0; i < positions.length; i++) {
        const v = Math.round((positions[i] ?? 0) * 1000);
        h1 = mix(h1, v);
        h2 = mix(h2, v >>> 16);
    }
    const indices = mesh.indices;
    for (let i = 0; i < indices.length; i++) {
        const v = indices[i] ?? 0;
        h1 = mix(h1, v);
        h2 = mix(h2, v >>> 16);
    }
    const id = sha256Hex(
        `${h1 >>> 0}:${h2 >>> 0}:${positions.length}:${indices.length}:${mesh.rimFaceStart ?? ""}:${mesh.outerVertex0 ?? ""}`,
    );
    meshIdentityCache.set(mesh, id);
    return id;
}

function normalize(value: unknown): unknown {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        return Math.round(value * 10000) / 10000;
    }
    if (typeof value === "string" || typeof value === "boolean" || value == null) return value;
    if (Array.isArray(value)) return value.map((item) => normalize(item));
    if (typeof value === "object") {
        const out: Record<string, unknown> = {};
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record).sort()) out[key] = normalize(record[key]);
        return out;
    }
    return null;
}

export interface AfoShellFingerprintInput {
    afo: AfoDesignState;
    castMesh: AfoTriMesh | null;
    correctedMesh: AfoTriMesh | null;
    meshRevision: number;
}

function workingMeshKind(input: AfoShellFingerprintInput): "corrected" | "cast" | "none" {
    if (input.correctedMesh) return "corrected";
    if (input.castMesh) return "cast";
    return "none";
}

/**
 * Hash of every input the shell is built from: cast identity, corrections,
 * trim, thickness / edge / flare, plantar flatten, and the flat-AFO plug-in.
 */
export function afoShellInputFingerprint(input: AfoShellFingerprintInput): string {
    const afo = input.afo;
    return sha256Hex(
        JSON.stringify(
            normalize({
                meshRevision: input.meshRevision,
                castMesh: afoMeshIdentity(input.castMesh),
                correctedMesh: afoMeshIdentity(input.correctedMesh),
                working: workingMeshKind(input),
                corrections: afo.corrections,
                reliefs: afo.reliefs,
                clinicalMarkers: afo.clinicalMarkers,
                landmarks: afo.landmarks,
                crest: afo.crest,
                effectiveFeatherMm: afo.effectiveFeatherMm,
                cast: {
                    removeCastMm: afo.cast.removeCastMm,
                    shinOffsetMm: afo.cast.shinOffsetMm,
                    insensate: afo.cast.insensate,
                    flattenBottom: afo.cast.flattenBottom,
                    flattenRemoveMm: afo.cast.flattenRemoveMm,
                    flattenAddMm: afo.cast.flattenAddMm,
                    shinBox: afo.cast.shinBox,
                    toeBox: afo.cast.toeBox,
                },
                trimPoints: afo.trimPoints,
                trimCurve: afo.trimCurve,
                trimClosed: afo.trimClosed,
                print: {
                    thicknessMm: afo.print.thicknessMm,
                    edgeMm: afo.print.edgeMm,
                    flareMm: afo.print.flareMm,
                },
                flatAfo: afo.flatAfo,
            }),
        ),
    );
}

export function currentAfoShellFingerprint(): string {
    const session = useAfoStore.getState();
    return afoShellInputFingerprint({
        afo: getAfoState(),
        castMesh: session.castMesh,
        correctedMesh: session.correctedMesh,
        meshRevision: session.meshRevision,
    });
}

/**
 * The preview and every export use this, not `shellReady` on its own.
 * A restored design can say the shell is ready while the session mesh was
 * built from different trim points.
 */
export function afoShellIsCurrent(): boolean {
    const afo = getAfoState();
    const session = useAfoStore.getState();
    if (!afo.shellReady || !session.shellMesh || !session.shellFingerprint) return false;
    return session.shellFingerprint === currentAfoShellFingerprint();
}

export function afoBlockedShellExports(): AfoShellExportKind[] {
    return afoShellIsCurrent() ? [] : [...AFO_SHELL_EXPORT_KINDS];
}

/** Subscribe to the design and session inputs the fingerprint reads. */
export function useAfoShellCurrent(): boolean {
    void useDesignStore((s) => s.design.afo?.trimPoints);
    void useDesignStore((s) => s.design.afo?.trimCurve);
    void useDesignStore((s) => s.design.afo?.print);
    void useDesignStore((s) => s.design.afo?.flatAfo);
    void useDesignStore((s) => s.design.afo?.corrections);
    void useDesignStore((s) => s.design.afo?.cast);
    void useDesignStore((s) => s.design.afo?.shellReady);
    void useAfoStore((s) => s.shellFingerprint);
    void useAfoStore((s) => s.shellMesh);
    void useAfoStore((s) => s.meshRevision);
    void useAfoStore((s) => s.castMesh);
    void useAfoStore((s) => s.correctedMesh);
    return afoShellIsCurrent();
}

export function decideShellCommit(input: {
    startedFingerprint: string;
    currentFingerprint: string;
    startedToken: number;
    currentToken: number;
}): "commit" | "stale" {
    if (input.startedToken !== input.currentToken) return "stale";
    if (input.startedFingerprint !== input.currentFingerprint) return "stale";
    return "commit";
}

/**
 * Keep a finished shell only when the inputs and the generation token still
 * match the build that produced it. A drag or a newer build discards it.
 */
export function commitShellIfCurrent(input: {
    startedFingerprint: string;
    startedToken: number;
    shell: AfoTriMesh;
}): "ok" | "stale" {
    const decision = decideShellCommit({
        startedFingerprint: input.startedFingerprint,
        currentFingerprint: currentAfoShellFingerprint(),
        startedToken: input.startedToken,
        currentToken: currentShellGeneration(),
    });
    if (decision === "stale") return "stale";
    useAfoStore.getState().commitShell(input.shell, input.startedFingerprint);
    patchAfoState({ shellReady: true }, "afo-shell");
    return "ok";
}
