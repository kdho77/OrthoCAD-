// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useState } from "react";

/** Client-side navigation without adding a router library. */
export function navigate(path: string): void {
    const url = new URL(path, window.location.origin);
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;
    window.history.pushState({}, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePathname(): string {
    const [path, setPath] = useState(() => (typeof window === "undefined" ? "/" : window.location.pathname));
    useEffect(() => {
        const onPop = () => setPath(window.location.pathname);
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);
    return path;
}

export function isSlicerPath(pathname: string): boolean {
    return pathname === "/slicer" || pathname.startsWith("/slicer/");
}
