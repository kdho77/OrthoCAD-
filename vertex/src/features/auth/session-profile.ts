// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { License, Role, UserProfile } from "@/types";

export interface SessionIdentity {
    id: string;
    email: string;
    fullName: string | null;
    role: Role;
}

/**
 * Keep the existing token balance when the same user is re-hydrated (token refresh,
 * tab focus, INITIAL_SESSION). Wiping it to 0 made export look like the account
 * had no tokens even though the server balance was unchanged.
 */
export function mergeSessionIdentity(existing: UserProfile | null, incoming: SessionIdentity): UserProfile {
    const sameUser = existing?.id === incoming.id;
    return {
        ...incoming,
        tokenBalance: sameUser ? existing.tokenBalance : 0,
    };
}

/** Auth events that should re-fetch token balance + license from `user.me`. */
export function shouldReloadAuthoritativeProfile(event: string): boolean {
    return event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED";
}

function toIso(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return value;
}

export function licenseFromMe(
    license: {
        id: string;
        type: string;
        status: string;
        seats: number;
        startsAt: string | Date;
        expiresAt: string | Date | null;
    } | null,
): License | null {
    if (!license) return null;
    return {
        id: license.id,
        type: license.type as License["type"],
        status: license.status as License["status"],
        seats: license.seats,
        startsAt: toIso(license.startsAt) ?? new Date().toISOString(),
        expiresAt: toIso(license.expiresAt),
    };
}
