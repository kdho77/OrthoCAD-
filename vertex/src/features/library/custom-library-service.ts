import * as THREE from "three";
import { canSaveCustom, SAVE_CUSTOM_TOKEN_COST } from "@/features/licensing/license";
import { getKernel } from "@/lib/chili3d";
import { boundsFromObject, registerCustomElementBounds } from "@/lib/geometry/custom-element-bounds";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { applyTrimLines, applyVertexOverrides } from "@/lib/geometry/mesh-edit";
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
        const params = insoleParamsFromDesign(design, side, "full");
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
