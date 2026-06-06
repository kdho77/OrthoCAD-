import type { License, UserProfile } from "@/types";

export interface LicenseCheck {
    ok: boolean;
    reason?: string;
}

export function isLicenseValid(license: License | null): LicenseCheck {
    if (!license) return { ok: false, reason: "No active license" };
    if (license.status === "revoked") return { ok: false, reason: "License revoked" };
    if (license.status === "expired") return { ok: false, reason: "License expired" };
    if (license.expiresAt && new Date(license.expiresAt).getTime() < Date.now()) {
        return { ok: false, reason: "License expired" };
    }
    return { ok: true };
}

/**
 * Token cost per export format. Mirrors the server-side schedule. GLB is the
 * watertight CAD preview/printable asset — it is gated by license validity but
 * does not consume tokens (mirrors the server: only STL/G-code are token-tracked).
 */
export const TOKEN_COST: Record<"stl" | "gcode" | "glb", number> = {
    stl: 1,
    gcode: 2,
    glb: 0,
};

/** Token cost for saving a custom GLB to the personal library. */
export const SAVE_CUSTOM_TOKEN_COST = 1;

export function canExport(
    user: UserProfile | null,
    license: License | null,
    format: "stl" | "gcode" | "glb",
): LicenseCheck {
    const lic = isLicenseValid(license);
    if (!lic.ok) return lic;
    if (!user) return { ok: false, reason: "Not signed in" };
    if (user.tokenBalance < TOKEN_COST[format]) {
        return { ok: false, reason: "Insufficient export tokens" };
    }
    return { ok: true };
}

export function canSaveCustom(user: UserProfile | null, license: License | null): LicenseCheck {
    const lic = isLicenseValid(license);
    if (!lic.ok) return lic;
    if (!user) return { ok: false, reason: "Not signed in" };
    if (user.tokenBalance < SAVE_CUSTOM_TOKEN_COST) {
        return { ok: false, reason: "Insufficient tokens to save custom asset" };
    }
    return { ok: true };
}
