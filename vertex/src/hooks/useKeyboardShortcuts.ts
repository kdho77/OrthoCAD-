// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect } from "react";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { useScanStore } from "@/stores/scan-store";

export interface KeyboardShortcutHandlers {
    onSave?: () => void;
    onExport?: () => void;
    onPrescription?: () => void;
    onToggleTransparent?: () => void;
}

/** Global keyboard shortcuts for clinical CAD workflows. */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
    const setViewer = useDesignStore((s) => s.setViewer);
    const selectElement = useDesignStore((s) => s.selectElement);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;
            const target = e.target as HTMLElement | null;
            if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable)
                return;

            if (mod && e.key.toLowerCase() === "s") {
                e.preventDefault();
                handlers.onSave?.();
                return;
            }
            if (mod && e.key.toLowerCase() === "e") {
                e.preventDefault();
                handlers.onExport?.();
                return;
            }
            if (mod && e.key.toLowerCase() === "p") {
                e.preventDefault();
                handlers.onPrescription?.();
                return;
            }
            if (e.key.toLowerCase() === "t" && !mod) {
                if (handlers.onToggleTransparent) handlers.onToggleTransparent();
                else setViewer({ transparent: !useDesignStore.getState().viewer.transparent });
                return;
            }
            if (e.key === "Escape") {
                const meshEdit = useMeshEditStore.getState();
                if (meshEdit.editMode === "edit-trimline" && meshEdit.trimlineEdit) {
                    meshEdit.cancelTrimlineEdit();
                    return;
                }
                const scan = useScanStore.getState();
                if (scan.rotateDraft) {
                    scan.cancelRotate({ restore: true });
                    return;
                }
                if (scan.placementMode) {
                    scan.exitPlacement();
                    return;
                }
                selectElement(null);
                scan.selectScan(null);
            }

            // Phase 3A production undo/redo (Cmd/Ctrl+Z, Shift for redo).
            if (mod && e.key.toLowerCase() === "z") {
                e.preventDefault();
                const ds = useDesignStore.getState();
                if (e.shiftKey) {
                    if (ds.canRedo()) ds.redo();
                } else {
                    if (ds.canUndo()) ds.undo();
                }
                return;
            }

            // Confirm active trimline edit session with Enter (production editing convenience).
            if (e.key === "Enter") {
                const meshEdit = useMeshEditStore.getState();
                if (meshEdit.editMode === "edit-trimline" && meshEdit.trimlineEdit) {
                    e.preventDefault();
                    meshEdit.confirmTrimlineEdit();
                    return;
                }
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handlers, setViewer, selectElement]);
}
