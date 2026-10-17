// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SlicerPage } from "@/features/slicer/SlicerPage";
import { SlicerShell } from "@/features/slicer/SlicerShell";

/**
 * Standalone pay-per-file slicer. Intentionally does not mount CAD chrome,
 * design store, stock-base loaders, clients, or orders.
 */
export function SlicerApp() {
    return (
        <ErrorBoundary>
            <SlicerShell>
                <SlicerPage />
            </SlicerShell>
        </ErrorBoundary>
    );
}
