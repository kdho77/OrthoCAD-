// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// OS detection for the print-bridge installer. The short pairing code is not a credential.

export type InstallerOs = "windows" | "macos" | "other";

export interface InstallerDownload {
    os: InstallerOs;
    label: string;
    href: string;
    filename: string;
}

const RELEASE = "https://github.com/kdho77/OrthoCAD-/releases/latest/download";

export const INSTALLERS: Record<"windows" | "macos" | "macos-dmg", InstallerDownload> = {
    windows: {
        os: "windows",
        label: "Download for Windows",
        href: `${RELEASE}/OrthoCAD-Print-Bridge-Setup.exe`,
        filename: "OrthoCAD-Print-Bridge-Setup.exe",
    },
    macos: {
        os: "macos",
        label: "Download for Mac",
        href: `${RELEASE}/OrthoCAD-Print-Bridge.pkg`,
        filename: "OrthoCAD-Print-Bridge.pkg",
    },
    "macos-dmg": {
        os: "macos",
        label: "Download the Mac disk image",
        href: `${RELEASE}/OrthoCAD-Print-Bridge.dmg`,
        filename: "OrthoCAD-Print-Bridge.dmg",
    },
};

export function detectInstallerOs(hints: { userAgent?: string; platform?: string }): InstallerOs {
    const agent = `${hints.userAgent ?? ""} ${hints.platform ?? ""}`;
    if (/iPhone|iPad|Android/i.test(agent)) return "other";
    if (/Windows|Win32|Win64/i.test(agent)) return "windows";
    if (/Macintosh|Mac OS X|MacIntel/i.test(agent)) return "macos";
    return "other";
}

export const RELEASE_CLOUD_ORIGIN = "https://orthocad.vertexorthopedic.com";

export const INSTALLER_UNPUBLISHED_NOTICE =
    "The installer is not published yet. It will appear here when the release is ready. You do not need to type a command.";

export interface InstallerPublication {
    known: boolean;
    windows: boolean;
    macos: boolean;
    dmg: boolean;
}

export async function lookupPublishedInstallers(
    fetchImpl: typeof fetch = fetch,
): Promise<InstallerPublication> {
    const missing = { known: true, windows: false, macos: false, dmg: false };
    try {
        const response = await fetchImpl("https://api.github.com/repos/kdho77/OrthoCAD-/releases/latest", {
            headers: { accept: "application/vnd.github+json" },
        });
        if (!response.ok) return missing;
        const body = (await response.json()) as { assets?: { name?: string }[] };
        const names = new Set((body.assets ?? []).map((asset) => asset.name).filter(Boolean));
        return {
            known: true,
            windows: names.has(INSTALLERS.windows.filename),
            macos: names.has(INSTALLERS.macos.filename),
            dmg: names.has(INSTALLERS["macos-dmg"].filename),
        };
    } catch {
        return missing;
    }
}
export function installerChoices(os: InstallerOs): {
    primary: InstallerDownload | null;
    alternate: InstallerDownload | null;
} {
    if (os === "windows") return { primary: INSTALLERS.windows, alternate: INSTALLERS.macos };
    if (os === "macos") return { primary: INSTALLERS.macos, alternate: INSTALLERS.windows };
    return { primary: null, alternate: null };
}
