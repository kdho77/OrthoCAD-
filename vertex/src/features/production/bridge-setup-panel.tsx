// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Install, pair, and guide. Enrollment proofs and bridge credentials are not rendered.

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import {
    detectInstallerOs,
    INSTALLER_UNPUBLISHED_NOTICE,
    INSTALLERS,
    type InstallerPublication,
    installerChoices,
    lookupPublishedInstallers,
} from "./installer-download";
import { approveBridgePairing, listEnrolledBridges, type ProductionShop } from "./production-actions";

function isProductionAdmin(role: string | undefined): boolean {
    return role === "admin" || role === "super_admin";
}

export function BridgeSetupPanel({ shop }: { shop?: ProductionShop }) {
    const role = useAuthStore((state) => state.user?.role);
    const os = detectInstallerOs({
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        platform: typeof navigator === "undefined" ? "" : navigator.platform,
    });
    const choices = installerChoices(os);
    const admin = isProductionAdmin(role);
    const needsShop = role === "super_admin";
    const initialCode =
        typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("pair") ?? "");
    const [code, setCode] = useState(initialCode);
    const [bridgeName, setBridgeName] = useState("");
    const [replaceBridgeId, setReplaceBridgeId] = useState("");
    const [bridges, setBridges] = useState<{ id: string; name: string }[]>([]);
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState("");
    const [approvedId, setApprovedId] = useState("");
    const [published, setPublished] = useState<InstallerPublication | null>(null);

    useEffect(() => {
        let cancelled = false;
        void lookupPublishedInstallers()
            .then((result) => {
                if (!cancelled) setPublished(result);
            })
            .catch(() => {
                if (!cancelled) setPublished({ known: true, windows: false, macos: false, dmg: false });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const shopId = shop?.tenantId ?? "";
    useEffect(() => {
        if (!admin || (needsShop && !shopId)) {
            setBridges([]);
            return;
        }
        let cancelled = false;
        void listEnrolledBridges(shopId ? { tenantId: shopId, shopId } : undefined)
            .then((result) => {
                if (!cancelled) setBridges(result?.bridges ?? []);
            })
            .catch(() => {
                if (!cancelled) setBridges([]);
            });
        return () => {
            cancelled = true;
        };
    }, [admin, needsShop, shopId]);

    const approve = () => {
        if (!admin || pending || (needsShop && !shop)) return;
        setNotice("");
        setPending(true);
        void approveBridgePairing({
            code,
            bridgeName,
            replaceBridgeId: replaceBridgeId || undefined,
            shop,
        })
            .then((result) => {
                setApprovedId(result.bridgeId);
                setCode("");
                setBridgeName("");
                setNotice(
                    replaceBridgeId
                        ? "This computer replaces the existing bridge. It will come online when pairing finishes."
                        : "This computer is approved. It will come online when pairing finishes.",
                );
            })
            .catch((error: unknown) => {
                setApprovedId("");
                setNotice(error instanceof Error ? error.message : "Pairing was not approved.");
            })
            .finally(() => setPending(false));
    };

    const primaryReady = choices.primary
        ? choices.primary.os === "windows"
            ? published?.windows
            : published?.macos
        : false;
    const alternateReady = choices.alternate
        ? choices.alternate.os === "windows"
            ? published?.windows
            : published?.macos
        : false;

    return (
        <div className="flex flex-col gap-3">
            <div
                className="rounded-xl border border-border bg-panel p-3"
                data-testid="bridge-installer-download"
            >
                <h2 className="text-sm font-medium">Install the print bridge</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                    Open the installer for this computer. It starts the bridge for you. There is nothing to
                    type in a command window.
                </p>
                <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap">
                    {published && choices.primary && !primaryReady ? (
                        <p className="text-sm text-muted-foreground" data-testid="installer-unpublished">
                            {INSTALLER_UNPUBLISHED_NOTICE}
                        </p>
                    ) : null}
                    {choices.primary && primaryReady ? (
                        <a
                            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground"
                            href={choices.primary.href}
                            download={choices.primary.filename}
                            data-testid="installer-primary"
                        >
                            {choices.primary.label}
                        </a>
                    ) : null}
                    {!choices.primary && published ? (
                        <p className="text-sm text-muted-foreground" data-testid="installer-other-os">
                            Choose Windows or Mac. This browser is not one of those installers.
                        </p>
                    ) : null}
                    {choices.alternate && alternateReady ? (
                        <a
                            className="inline-flex min-h-11 items-center rounded-md bg-secondary px-4 text-sm"
                            href={choices.alternate.href}
                            download={choices.alternate.filename}
                            data-testid="installer-alternate"
                        >
                            {choices.alternate.os === "windows"
                                ? "Download for Windows instead"
                                : "Download for Mac instead"}
                        </a>
                    ) : null}
                    {!choices.primary && published && !published.windows && !published.macos ? (
                        <p className="text-sm text-muted-foreground" data-testid="installer-unpublished">
                            {INSTALLER_UNPUBLISHED_NOTICE}
                        </p>
                    ) : null}
                    {!choices.primary && published?.windows ? (
                        <a
                            className="inline-flex min-h-11 items-center rounded-md bg-secondary px-4 text-sm"
                            href={INSTALLERS.windows.href}
                            data-testid="installer-choice-windows"
                        >
                            Download for Windows
                        </a>
                    ) : null}
                    {!choices.primary && published?.macos ? (
                        <a
                            className="inline-flex min-h-11 items-center rounded-md bg-secondary px-4 text-sm"
                            href={INSTALLERS.macos.href}
                            data-testid="installer-choice-mac"
                        >
                            Download for Mac
                        </a>
                    ) : null}
                    {published?.dmg ? (
                        <a
                            className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline"
                            href={INSTALLERS["macos-dmg"].href}
                        >
                            {INSTALLERS["macos-dmg"].label}
                        </a>
                    ) : null}
                </div>
            </div>
            <div className="rounded-xl border border-border bg-panel p-3" data-testid="bridge-setup-guide">
                <h2 className="text-sm font-medium">How setup works</h2>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>Download the installer and open it. The bridge starts when installation finishes.</li>
                    <li>The bridge opens this page and shows a short pairing code on the shop computer.</li>
                    <li>An admin enters that code below and approves the computer for this shop.</li>
                    <li>Add a printer from the discovered list, or type its address if it is not listed.</li>
                    <li>
                        Online means the bridge has checked in and the printer answered a read-only status
                        request.
                    </li>
                </ol>
            </div>
            {admin ? (
                <div
                    className="rounded-xl border border-border bg-panel p-3"
                    data-testid="create-bridge-enrollment"
                >
                    <h2 className="text-sm font-medium">Approve a print bridge</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Enter the pairing code shown on the shop computer. The code is not a password, and
                        this page does not show a bridge credential.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap">
                        <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                            Pairing code
                            <input
                                aria-label="Pairing code"
                                value={code}
                                maxLength={32}
                                autoComplete="off"
                                placeholder="ABCD-EFGH"
                                className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                                onChange={(event) => setCode(event.target.value)}
                            />
                        </label>
                        <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                            Bridge name
                            <input
                                aria-label="Bridge name"
                                value={bridgeName}
                                maxLength={80}
                                autoComplete="off"
                                className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                                onChange={(event) => setBridgeName(event.target.value)}
                            />
                        </label>
                        <button
                            type="button"
                            className="min-h-11 self-end rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
                            disabled={
                                pending ||
                                code.trim().length < 4 ||
                                bridgeName.trim().length === 0 ||
                                (needsShop && !shop)
                            }
                            onClick={approve}
                        >
                            Approve bridge
                        </button>
                    </div>
                    {bridges.length > 0 ? (
                        <label className="mt-3 block text-xs text-muted-foreground">
                            Existing bridge
                            <select
                                aria-label="Existing bridge"
                                value={replaceBridgeId}
                                className="mt-1 block min-h-11 w-full max-w-md rounded-md border border-input bg-background px-2 text-sm text-foreground"
                                onChange={(event) => setReplaceBridgeId(event.target.value)}
                            >
                                <option value="">New bridge</option>
                                {bridges.map((bridge) => (
                                    <option key={bridge.id} value={bridge.id}>
                                        Replace {bridge.name} ({bridge.id.slice(0, 8)})
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                    {approvedId ? (
                        <p className="mt-3 text-sm" data-testid="bridge-pairing-approved">
                            Approved bridge <span className="font-mono">{approvedId}</span>
                        </p>
                    ) : null}
                    {notice ? <p className="mt-2 text-sm text-amber-300">{notice}</p> : null}
                </div>
            ) : null}
        </div>
    );
}
