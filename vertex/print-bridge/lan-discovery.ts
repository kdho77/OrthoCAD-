// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop-LAN discovery. The only printer request this module builds is GET /server/info.
// Tests pass a fake probe. Nothing in this file starts a print.

import { networkInterfaces } from "node:os";
import {
    collectDiscoveryCandidates,
    type MdnsServiceRecord,
    planLanScanHosts,
    READ_ONLY_INFO_PATH,
    readOnlyInfoRequest,
    type ScanHit,
} from "../shared/print-bridge-discovery.js";
import type { DiscoveryCandidateRecord } from "../shared/print-bridge-pairing.js";
import { productionAddressPolicy } from "../shared/printer-address-policy.js";

export type InfoProbe = (address: string) => Promise<string | null>;

export function localLanAddresses(): string[] {
    const found: string[] = [];
    for (const entries of Object.values(networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.internal || entry.family !== "IPv4") continue;
            const hosts = planLanScanHosts(entry.address);
            if (!Array.isArray(hosts)) continue;
            found.push(entry.address);
        }
    }
    return found;
}

export async function discoverLanPrinters(input: {
    localAddresses: string[];
    mdns?: MdnsServiceRecord[];
    probe: InfoProbe;
    scanPorts?: boolean;
}): Promise<DiscoveryCandidateRecord[]> {
    const policy = productionAddressPolicy();
    const scans: ScanHit[] = [];
    if (input.scanPorts !== false) {
        for (const localAddress of input.localAddresses) {
            const hosts = planLanScanHosts(localAddress);
            if (!Array.isArray(hosts)) continue;
            for (const host of hosts) {
                const address = `http://${host}:7125`;
                const body = await input.probe(address);
                if (body) scans.push({ host, port: 7125, infoBody: body });
            }
        }
    }
    return collectDiscoveryCandidates({ mdns: input.mdns ?? [], scans }, policy).accepted;
}

/** GET /server/info and nothing else. Redirects are not followed. */
export async function probeServerInfo(
    address: string,
    request: typeof fetch = fetch,
): Promise<string | null> {
    const built = readOnlyInfoRequest(address, productionAddressPolicy());
    if ("error" in built || built.method !== "GET" || built.url.pathname !== READ_ONLY_INFO_PATH) return null;
    const response = await request(built.url, { method: "GET", redirect: "manual" });
    if (response.status < 200 || response.status >= 300) return null;
    return response.text();
}
