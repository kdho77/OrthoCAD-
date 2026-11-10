// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Discovered printers and a read-only connection test. No print commands are sent from this page.

import { useEffect, useState } from "react";
import { listBridgeDiscovery, requestPrinterConnectionTest } from "./production-actions";

interface Candidate {
    bridgeId: string;
    host: string;
    port: number;
    address: string;
    source: "mdns" | "scan";
    info: {
        hostname: string | null;
        moonrakerVersion: string | null;
        klippyState: string | null;
        apiVersion: string | null;
    } | null;
}

export function AddPrinterPanel({
    bridgeId,
    address,
    onUseAddress,
}: {
    bridgeId: string;
    address: string;
    onUseAddress: (address: string) => void;
}) {
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [notice, setNotice] = useState("");
    const [summary, setSummary] = useState("");

    useEffect(() => {
        let cancelled = false;
        void listBridgeDiscovery()
            .then((result) => {
                if (cancelled) return;
                setCandidates(result?.candidates ?? []);
                if (result?.lastTest?.info) {
                    setSummary(formatInfo(result.lastTest.address, result.lastTest.info));
                }
            })
            .catch(() => {
                if (!cancelled) setCandidates([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const testConnection = (targetAddress: string, targetBridgeId: string) => {
        setNotice("");
        if (!targetAddress.trim()) {
            setNotice("Enter a printer address before testing a connection.");
            return;
        }
        if (!targetBridgeId) {
            setNotice("Enter the bridge id before testing a connection.");
            return;
        }
        void requestPrinterConnectionTest({ bridgeId: targetBridgeId, address: targetAddress })
            .then((result) => {
                if (result.method !== "GET" || result.path !== "/server/info") {
                    setNotice("Connection test was refused.");
                    return;
                }
                setNotice(`Read-only info check requested for ${result.address}. No print will be started.`);
            })
            .catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : "Connection test was refused.");
            });
    };

    return (
        <div className="rounded-xl border border-border bg-panel p-3" data-testid="add-printer-discovery">
            <h2 className="text-sm font-medium">Add a printer</h2>
            <p className="mt-1 text-xs text-muted-foreground">
                The enrolled bridge looks for Moonraker on the shop network and reads printer info only. You
                can still type an address in Configure Moonraker printer.
            </p>
            {candidates.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground" data-testid="discovery-empty">
                    No printers discovered yet. The bridge reports them after it is online.
                </p>
            ) : (
                <ul className="mt-3 flex flex-col gap-2">
                    {candidates.map((candidate) => (
                        <li
                            key={`${candidate.bridgeId}:${candidate.address}`}
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            data-testid="discovered-printer"
                        >
                            <p className="font-medium">
                                {candidate.info?.hostname || candidate.host}:{candidate.port}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {candidate.address} · {candidate.source === "mdns" ? "Bonjour" : "Port 7125"}
                                {candidate.info?.klippyState ? ` · ${candidate.info.klippyState}` : ""}
                                {candidate.info?.moonrakerVersion
                                    ? ` · ${candidate.info.moonrakerVersion}`
                                    : ""}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className="min-h-11 rounded-md bg-primary px-3 text-xs text-primary-foreground"
                                    onClick={() => onUseAddress(candidate.address)}
                                >
                                    Use this address
                                </button>
                                <button
                                    type="button"
                                    className="min-h-11 rounded-md bg-secondary px-3 text-xs"
                                    onClick={() => testConnection(candidate.address, candidate.bridgeId)}
                                >
                                    Test connection
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <div className="mt-3">
                <button
                    type="button"
                    className="min-h-11 rounded-md bg-secondary px-3 text-xs"
                    data-testid="printer-connection-test"
                    onClick={() => testConnection(address, bridgeId)}
                >
                    Test connection
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                    The test asks the bridge for GET /server/info. It does not upload, heat, move, or start a
                    print.
                </p>
            </div>
            {summary ? <p className="mt-2 text-sm">{summary}</p> : null}
            {notice ? <p className="mt-2 text-sm text-amber-300">{notice}</p> : null}
        </div>
    );
}

function formatInfo(
    address: string,
    info: { hostname: string | null; klippyState: string | null; moonrakerVersion: string | null },
): string {
    return `Last read-only check ${address}: ${info.hostname ?? "printer"} ${info.klippyState ?? "status unknown"} ${info.moonrakerVersion ?? ""}`.trim();
}
