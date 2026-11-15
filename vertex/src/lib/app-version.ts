// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

export const VERSION_JSON_PATH = "/version.json";
export const VERSION_POLL_MS = 5 * 60 * 1000;

export interface VersionJson {
    id: string;
}

let bundledBuildIdOverride: string | null = null;

/** Build id baked into this JS bundle (overridable in tests). */
export function bundledBuildId(): string {
    if (bundledBuildIdOverride !== null) return bundledBuildIdOverride;
    try {
        if (typeof __APP_BUILD_ID__ === "string" && __APP_BUILD_ID__) return __APP_BUILD_ID__;
    } catch {
        // Node / rstest without Vite define.
    }
    return "local-dev";
}

export function setBundledBuildIdForTests(id: string | null): void {
    bundledBuildIdOverride = id;
}

export function parseVersionJson(body: unknown): VersionJson | null {
    if (!body || typeof body !== "object") return null;
    const id = (body as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) return null;
    return { id: id.trim() };
}

/** When remote id is missing, treat as same build (fail open). */
export function buildIdsDiffer(bundledId: string, remoteId: string | null | undefined): boolean {
    if (remoteId == null || remoteId === "") return false;
    return bundledId !== remoteId;
}

export type VersionCheckState = "unknown" | "current" | "stale";

let remoteBuildId: string | null = null;
let versionCheckState: VersionCheckState = "unknown";

export function getRemoteBuildId(): string | null {
    return remoteBuildId;
}

export function getVersionCheckState(): VersionCheckState {
    return versionCheckState;
}

export function isStaleBuild(): boolean {
    return versionCheckState === "stale";
}

export function resetAppVersionRuntimeForTests(): void {
    remoteBuildId = null;
    versionCheckState = "unknown";
    bundledBuildIdOverride = null;
}

export function applyRemoteBuildId(remoteId: string | null): VersionCheckState {
    if (remoteId === null) {
        remoteBuildId = null;
        versionCheckState = "unknown";
        return versionCheckState;
    }
    remoteBuildId = remoteId;
    versionCheckState = buildIdsDiffer(bundledBuildId(), remoteId) ? "stale" : "current";
    return versionCheckState;
}

export async function fetchDeployedBuildId(signal?: AbortSignal): Promise<string | null> {
    try {
        const url = `${VERSION_JSON_PATH}?_=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) return null;
        const json: unknown = await res.json();
        return parseVersionJson(json)?.id ?? null;
    } catch {
        return null;
    }
}

export async function refreshAppVersionCheck(signal?: AbortSignal): Promise<VersionCheckState> {
    const remote = await fetchDeployedBuildId(signal);
    return applyRemoteBuildId(remote);
}
