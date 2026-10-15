// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useState } from "react";
import type { Role } from "@/types";

export function showSuperAdminLink(role: Role | undefined | null): boolean {
    return role === "super_admin";
}

export function navigate(to: string): void {
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === to) return;
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useLocationPath(): { pathname: string; search: string } {
    const [loc, setLoc] = useState(() => ({
        pathname: window.location.pathname,
        search: window.location.search,
    }));
    useEffect(() => {
        const onPop = () =>
            setLoc({
                pathname: window.location.pathname,
                search: window.location.search,
            });
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);
    return loc;
}
