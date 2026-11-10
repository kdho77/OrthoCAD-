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

export function installerChoices(os: InstallerOs): {
    primary: InstallerDownload | null;
    alternate: InstallerDownload | null;
} {
    if (os === "windows") return { primary: INSTALLERS.windows, alternate: INSTALLERS.macos };
    if (os === "macos") return { primary: INSTALLERS.macos, alternate: INSTALLERS.windows };
    return { primary: null, alternate: null };
}
