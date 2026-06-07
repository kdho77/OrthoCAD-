import * as THREE from "three";
import { canSaveCustom, SAVE_CUSTOM_TOKEN_COST } from "@/features/licensing/license";
import { getKernel } from "@/lib/chili3d/kernel";
import { baseModifierField, getDesignBase, loadBaseGeometry } from "@/lib/geometry/base-asset";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { boundsFromObject, registerCustomElementBounds } from "@/lib/geometry/custom-element-bounds";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { applyTrimLines, applyVertexOverrides } from "@/lib/geometry/mesh-edit";
import { getDesignTrimline } from "@/lib/geometry/trimline";
import { countMeshes, loadGlbFromBuffer } from "@/lib/library/loaders";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { useScanStore } from "@/stores/scan-store";
import type { ElementKind, Side } from "@/types";

export type SaveTargetKind = "element" | "prefab";

export interface SaveCustomInput {
    kind: SaveTargetKind;
    name: string;
    category: string;
    parentStockId?: string;
    /** When saving an element, the placed element id; for prefab, the insole side. */
    sourceId?: string;
    side?: Side;
}

export interface SaveCustomOutcome {
    ok: boolean;
    reason?: string;
    itemId?: string;
}

/** Fetch custom library from server (no-op offline). */
export async function refreshCustomLibrary(): Promise<void> {
    const store = useCustomLibraryStore.getState();
    store.setLoading(true);
    try {
        if (isApiConfigured()) {
            const [elements, prefabs] = await Promise.all([
                trpc.library.listElements.query(),
                trpc.library.listPrefabs.query(),
            ]);
            store.setCustomElements(
                elements.map((e) => ({
                    id: e.id,
                    name: e.name,
                    category: e.category,
                    stock: false,
                    parentStockId: e.parentStockId,
                    url: e.url,
                    glbPath: e.glbPath,
                    createdAt: e.createdAt,
                })),
            );
            store.setCustomPrefabs(
                prefabs.map((p) => ({
                    id: p.id,
                    name: p.name,
                    category: p.category,
                    stock: false,
                    parentStockId: p.parentStockId,
                    url: p.url,
                    glbPath: p.glbPath,
                    createdAt: p.createdAt,
                })),
            );
        }
    } finally {
        store.setLoading(false);
    }
}

async function authorizeSave(): Promise<{ ok: boolean; reason?: string }> {
    const { user, license, deductTokens } = useAuthStore.getState();
    if (isApiConfigured()) {
        const check = canSaveCustom(user, license);
        if (!check.ok) return check;
        return { ok: true };
    }
    const check = canSaveCustom(user, license);
    if (!check.ok) return check;
    deductTokens(SAVE_CUSTOM_TOKEN_COST);
    return { ok: true };
}

/** Build export mesh for the current edit target with trim/vertex modifications applied. */
export function buildExportMesh(input: SaveCustomInput): THREE.Mesh {
    const { trimLines, vertexOverrides } = useMeshEditStore.getState();
    const { design } = useDesignStore.getState();

    if (input.kind === "prefab") {
        const side = input.side ?? "left";
        const params = {
            ...insoleParamsFromDesign(design, side, "full"),
            trimline: getDesignTrimline(design, side),
        };
        let geometry = getKernel().buildInsole(params);
        geometry = applyTrimLines(geometry, trimLines);
        const vecMap = new Map<number, THREE.Vector3>();
        for (const [idx, v] of vertexOverrides) vecMap.set(idx, new THREE.Vector3(v.x, v.y, v.z));
        geometry = applyVertexOverrides(geometry, vecMap);
        return meshFromGeometry(geometry, side === "left" ? "#38bdf8" : "#22d3ee");
    }

    // Element export: use placed element footprint as an extruded bump mesh.
    const el = design.elements.find((e) => e.id === input.sourceId);
    if (!el) {
        return meshFromGeometry(new THREE.BoxGeometry(10, 10, 4), "#a855f7");
    }
    const geo = new THREE.CylinderGeometry(7 * el.scale.x, 7 * el.scale.x, el.heightMm, 24);
    const mesh = meshFromGeometry(geo, "#a855f7");
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(el.position.x, el.position.y, el.heightMm / 2);
    mesh.rotation.z = (el.rotationDeg * Math.PI) / 180;
    return mesh;
}

/**
 * Build an export mesh for a prefab that has an active base template by applying
 * the current modifiers (corrections / elements / thickness) to the loaded base
 * mesh, then layering trimline + vertex edits. Returns `null` when the design has
 * no base or the base GLB can't be resolved, so callers fall back to parametric.
 */
async function buildBasePrefabMesh(side: Side): Promise<THREE.Mesh | null> {
    const { design } = useDesignStore.getState();
    const base = getDesignBase(design);
    if (!base) return null;

    const raw = await loadBaseGeometry(base);
    if (!raw) return null;

    const field = baseModifierField(design, side, design.thicknessMm);
    let geometry = applyBaseModifiers(raw, field, 1);
    raw.dispose();

    const { trimLines, vertexOverrides } = useMeshEditStore.getState();
    geometry = applyTrimLines(geometry, trimLines);
    const vecMap = new Map<number, THREE.Vector3>();
    for (const [idx, v] of vertexOverrides) vecMap.set(idx, new THREE.Vector3(v.x, v.y, v.z));
    geometry = applyVertexOverrides(geometry, vecMap);
    return meshFromGeometry(geometry, "#a855f7");
}

/** Export scan mesh when saving from an imported scan prefab. */
export function buildScanExportMesh(scanId: string): THREE.Mesh | null {
    const scan = useScanStore.getState().scans.find((s) => s.id === scanId);
    if (!scan) return null;
    const { trimLines, vertexOverrides } = useMeshEditStore.getState();
    let geometry = scan.geometry.clone();
    geometry = applyTrimLines(geometry, trimLines);
    geometry = applyVertexOverrides(geometry, vertexOverrides);
    return meshFromGeometry(geometry, "#94a3b8");
}

/**
 * Save the current modified mesh as a custom GLB in the user's library.
 * Server path: upload + Prisma row + token deduct. Offline: local IndexedDB store.
 */
export async function saveCustomAsset(input: SaveCustomInput): Promise<SaveCustomOutcome> {
    const auth = await authorizeSave();
    if (!auth.ok) return { ok: false, reason: auth.reason };

    let mesh = buildExportMesh(input);
    if (input.kind === "prefab" && input.sourceId?.startsWith("scan:")) {
        const scanMesh = buildScanExportMesh(input.sourceId.slice(5));
        if (scanMesh) mesh = scanMesh;
    } else if (input.kind === "prefab" && getDesignBase(useDesignStore.getState().design)) {
        // Saving a modified base: capture the deformed base surface (not the
        // parametric mesh) so the new library item reflects the edited base.
        const baseMesh = await buildBasePrefabMesh(input.side ?? "left");
        if (baseMesh) {
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
            mesh = baseMesh;
        }
    }

    const elementBounds = input.kind === "element" ? boundsFromObject(mesh) : null;
    const { base64 } = await exportObjectToGlb(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();

    const offlineId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    if (isApiConfigured()) {
        try {
            const payload = {
                name: input.name,
                category: input.category,
                parentStockId: input.parentStockId,
                glbBase64: base64,
            };
            const res =
                input.kind === "element"
                    ? await trpc.library.saveElement.mutate(payload)
                    : await trpc.library.savePrefab.mutate(payload);

            if (!res.ok) return { ok: false, reason: "Save denied" };

            const { user, setUser } = useAuthStore.getState();
            if (user) setUser({ ...user, tokenBalance: res.balance });

            const item = {
                id: res.item.id,
                name: res.item.name,
                category: res.item.category,
                stock: false as const,
                parentStockId: res.item.parentStockId,
                url: res.item.url,
                glbPath: res.item.glbPath,
                createdAt: res.item.createdAt,
            };

            if (input.kind === "element") {
                useCustomLibraryStore.getState().addCustomElement(item, base64);
                if (elementBounds) registerCustomElementBounds(res.item.id, elementBounds);
            } else {
                useCustomLibraryStore.getState().addCustomPrefab(item, base64);
            }

            useAuditStore.getState().record("custom_library_saved", `${input.kind}: ${input.name}`);
            return { ok: true, itemId: res.item.id };
        } catch (e) {
            return { ok: false, reason: e instanceof Error ? e.message : "Save failed" };
        }
    }

    // Offline fallback — persist GLB locally.
    const item = {
        id: offlineId,
        name: input.name,
        category: input.category,
        stock: false as const,
        parentStockId: input.parentStockId ?? null,
        createdAt,
    };

    if (input.kind === "element") {
        useCustomLibraryStore.getState().addCustomElement(item, base64);
        if (elementBounds) registerCustomElementBounds(offlineId, elementBounds);
    } else {
        useCustomLibraryStore.getState().addCustomPrefab(item, base64);
    }

    useAuditStore.getState().record("custom_library_saved", `${input.kind}: ${input.name} (offline)`);
    return { ok: true, itemId: offlineId };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export interface UploadBaseOutcome {
    ok: boolean;
    reason?: string;
    itemId?: string;
    meshCount?: number;
    meshNames?: string[];
}

/**
 * Import an external `.glb` file as a reusable base in the user's custom library.
 * The GLB is parsed to count its meshes (a multi-mesh base such as Top + Bottom
 * is supported and merged at load time), then persisted locally as a custom
 * prefab so it can be loaded as a Base + Modifier template. No token cost — the
 * user supplies their own asset.
 */
export async function uploadBaseGlb(
    file: File,
    opts?: { name?: string; category?: string },
): Promise<UploadBaseOutcome> {
    if (!/\.glb$/i.test(file.name)) {
        return { ok: false, reason: "Only .glb files are supported" };
    }

    let buffer: ArrayBuffer;
    try {
        buffer = await file.arrayBuffer();
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "Could not read file" };
    }

    let meshCount = 0;
    let meshNames: string[] = [];
    try {
        const group = await loadGlbFromBuffer(buffer.slice(0));
        const info = countMeshes(group);
        meshCount = info.count;
        meshNames = info.names;
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "Invalid GLB file" };
    }
    if (meshCount === 0) {
        return { ok: false, reason: "GLB contains no mesh geometry" };
    }

    const base64 = arrayBufferToBase64(buffer);
    const id = crypto.randomUUID();
    const name = (opts?.name ?? file.name.replace(/\.glb$/i, "")).trim() || "Uploaded Base";
    const item = {
        id,
        name,
        category: opts?.category ?? "base",
        stock: false as const,
        parentStockId: null,
        createdAt: new Date().toISOString(),
        uploaded: true,
        meshCount,
    };

    useCustomLibraryStore.getState().addCustomPrefab(item, base64);
    useAuditStore
        .getState()
        .record("custom_library_uploaded", `base: ${name} (${meshCount} mesh${meshCount === 1 ? "" : "es"})`);
    return { ok: true, itemId: id, meshCount, meshNames };
}

/** Rename a custom library item (local; server rename is a no-op for now). */
export function renameCustomAsset(kind: SaveTargetKind, id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (kind === "element") useCustomLibraryStore.getState().renameCustomElement(id, trimmed);
    else useCustomLibraryStore.getState().renameCustomPrefab(id, trimmed);
}

/** Delete a custom library item (server + local). */
export async function deleteCustomAsset(kind: SaveTargetKind, id: string): Promise<void> {
    if (isApiConfigured()) {
        if (kind === "element") await trpc.library.deleteElement.mutate({ id });
        else await trpc.library.deletePrefab.mutate({ id });
    }
    if (kind === "element") useCustomLibraryStore.getState().removeCustomElement(id);
    else useCustomLibraryStore.getState().removeCustomPrefab(id);
}

/** Place a custom element from the library onto the design. */
export function placeCustomElement(customId: string, customName: string, side: Side): void {
    useDesignStore.getState().addCustomElement(customId, customName, side);
}

/** Apply a custom prefab as the active pattern reference. */
export function selectCustomPrefab(customId: string, customName: string): void {
    useDesignStore.getState().setCustomPrefab(customId, customName);
}

/** Infer parent stock id from a placed stock element kind. */
export function parentStockFromElement(kind: ElementKind): string {
    return kind;
}
