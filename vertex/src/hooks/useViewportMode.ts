// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useState } from "react";

export type ViewportMode = "phone" | "tablet" | "desktop";

export function viewportModeFromWidth(width: number): ViewportMode {
    if (width < 768) return "phone";
    if (width < 1100) return "tablet";
    return "desktop";
}

export function useViewportMode(): ViewportMode {
    const [mode, setMode] = useState<ViewportMode>(() =>
        typeof window === "undefined" ? "desktop" : viewportModeFromWidth(window.innerWidth),
    );
    useEffect(() => {
        const onResize = () => setMode(viewportModeFromWidth(window.innerWidth));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return mode;
}
