// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SlicerPage } from "@/features/slicer/SlicerPage";
import { SlicerShell } from "@/features/slicer/SlicerShell";

/**
 * Stripe returns the popup here. The opener still holds the sealed slice.
 */
function SlicerCheckoutReturn() {
    const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session_id") ?? "");
    useEffect(() => {
        if (!sessionId || !window.opener || window.opener.closed) return;
        window.opener.postMessage({ type: "orthocad-slicer-checkout", sessionId }, window.location.origin);
        window.close();
    }, [sessionId]);
    return (
        <div className="p-6 text-sm">
            <p>Payment received. Return to the slicer tab to download G-code.</p>
        </div>
    );
}

/**
 * Standalone pay-per-file slicer. Intentionally does not mount CAD chrome,
 * design store, stock-base loaders, clients, or orders.
 */
export function SlicerApp() {
    const checkoutReturn =
        typeof window !== "undefined" && window.location.pathname.startsWith("/slicer/checkout-return");
    if (checkoutReturn) {
        return (
            <ErrorBoundary>
                <SlicerCheckoutReturn />
            </ErrorBoundary>
        );
    }
    return (
        <ErrorBoundary>
            <SlicerShell>
                <SlicerPage />
            </SlicerShell>
        </ErrorBoundary>
    );
}
