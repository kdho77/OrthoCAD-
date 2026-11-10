// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// LAN discovery parsing for Moonraker. Read-only: GET /server/info only.
// This module does not open a socket. Callers inject a probe.

import type { DiscoveryCandidateRecord } from "./print-bridge-pairing.js";
import { type AddressPolicy, classifyIp } from "./printer-address-policy.js";

export const READ_ONLY_INFO_PATH = "/server/info";

export interface MdnsServiceRecord {
    type: string;
    host: string;
    port: number;
    name?: string;
}

export interface ScanHit {
    host: string;
    port: number;
    infoBody: string | null;
}

export interface ServerInfoSummary {
    hostname: string | null;
    moonrakerVersion: string | null;
    klippyState: string | null;
    apiVersion: string | null;
}

export interface DiscoveryRejection {
    address: string;
    reason: string;
}

const MOONRAKER_TYPE = /^_moonraker\._tcp(?:\.local)?$/i;
const REJECTED = "Printer address is not an approved LAN destination.";

export function summarizeServerInfo(body: string): ServerInfoSummary | { error: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { error: "Printer info was malformed." };
    }
    const result =
        parsed && typeof parsed === "object" && "result" in parsed
            ? (parsed as { result?: unknown }).result
            : parsed;
    if (!result || typeof result !== "object") return { error: "Printer info was malformed." };
    const record = result as Record<string, unknown>;
    const text = (key: string): string | null => {
        const value = record[key];
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        if (!trimmed || trimmed.length > 120) return null;
        return trimmed;
    };
    const api = record.api_version_string ?? record.apiVersion;
    return {
        hostname: text("hostname"),
        moonrakerVersion: text("moonraker_version") ?? text("moonrakerVersion"),
        klippyState: text("klippy_state") ?? text("klippyState"),
        apiVersion:
            typeof api === "string" && api.trim().length > 0 && api.trim().length <= 40 ? api.trim() : null,
    };
}

export function acceptDiscoveryAddress(
    host: string,
    port: number,
    policy: AddressPolicy,
): { ok: true; address: string } | { ok: false; reason: string } {
    const trimmed = host.trim().replace(/\.$/, "");
    if (!trimmed || trimmed.includes("@") || trimmed.includes("/") || trimmed.includes("\\")) {
        return { ok: false, reason: REJECTED };
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, reason: "Printer port is invalid." };
    }
    const address = `http://${trimmed}:${port}`;
    const decision = policy.decide(address);
    if (!decision.ok) return { ok: false, reason: decision.reason };
    const localName = trimmed.toLowerCase().endsWith(".local");
    if (localName) {
        if (!/^[a-z0-9.-]+$/i.test(trimmed)) return { ok: false, reason: REJECTED };
        return { ok: true, address };
    }
    if (decision.pinnedIp && classifyIp(decision.pinnedIp) === "loopback" && policy.allowLoopback) {
        return { ok: true, address };
    }
    if (!decision.pinnedIp || classifyIp(decision.pinnedIp) !== "lan") {
        return { ok: false, reason: REJECTED };
    }
    return { ok: true, address };
}

export function parseMdnsRecord(
    record: MdnsServiceRecord,
    policy: AddressPolicy,
): { ok: true; candidate: DiscoveryCandidateRecord } | { ok: false; reason: string; address: string } {
    const address = `http://${record.host}:${record.port}`;
    if (!MOONRAKER_TYPE.test(record.type.trim())) {
        return { ok: false, reason: "Discovery record is not a Moonraker service.", address };
    }
    const accepted = acceptDiscoveryAddress(record.host, record.port, policy);
    if (!accepted.ok) return { ok: false, reason: accepted.reason, address };
    const url = new URL(accepted.address);
    return {
        ok: true,
        candidate: {
            host: url.hostname,
            port: Number(url.port),
            address: accepted.address,
            source: "mdns",
            info: null,
        },
    };
}

export function parseScanHit(
    hit: ScanHit,
    policy: AddressPolicy,
): { ok: true; candidate: DiscoveryCandidateRecord } | { ok: false; reason: string; address: string } {
    const address = `http://${hit.host}:${hit.port}`;
    const accepted = acceptDiscoveryAddress(hit.host, hit.port, policy);
    if (!accepted.ok) return { ok: false, reason: accepted.reason, address };
    if (hit.port !== 7125) {
        return {
            ok: false,
            reason: "Port scan only accepts Moonraker port 7125.",
            address: accepted.address,
        };
    }
    if (!hit.infoBody)
        return { ok: false, reason: "Printer info was not returned.", address: accepted.address };
    const summary = summarizeServerInfo(hit.infoBody);
    if ("error" in summary) return { ok: false, reason: summary.error, address: accepted.address };
    const url = new URL(accepted.address);
    return {
        ok: true,
        candidate: {
            host: url.hostname,
            port: Number(url.port),
            address: accepted.address,
            source: "scan",
            info: summary,
        },
    };
}

export function collectDiscoveryCandidates(
    input: { mdns: MdnsServiceRecord[]; scans: ScanHit[] },
    policy: AddressPolicy,
): { accepted: DiscoveryCandidateRecord[]; rejected: DiscoveryRejection[] } {
    const accepted: DiscoveryCandidateRecord[] = [];
    const rejected: DiscoveryRejection[] = [];
    const seen = new Set<string>();
    for (const record of input.mdns) {
        const parsed = parseMdnsRecord(record, policy);
        if (!parsed.ok) {
            rejected.push({ address: parsed.address, reason: parsed.reason });
            continue;
        }
        if (seen.has(parsed.candidate.address)) continue;
        seen.add(parsed.candidate.address);
        accepted.push(parsed.candidate);
    }
    for (const hit of input.scans) {
        const parsed = parseScanHit(hit, policy);
        if (!parsed.ok) {
            rejected.push({ address: parsed.address, reason: parsed.reason });
            continue;
        }
        const existing = accepted.find((item) => item.address === parsed.candidate.address);
        if (existing) {
            existing.info = parsed.candidate.info;
            continue;
        }
        seen.add(parsed.candidate.address);
        accepted.push(parsed.candidate);
    }
    return { accepted, rejected };
}

export function readOnlyInfoRequest(
    address: string,
    policy: AddressPolicy,
): { method: "GET"; url: URL } | { error: string } {
    let url: URL;
    try {
        url = new URL(address.trim());
    } catch {
        return { error: "Printer address must be an http(s) URL with a host and port." };
    }
    const accepted = acceptDiscoveryAddress(url.hostname, Number(url.port), policy);
    if (!accepted.ok) return { error: accepted.reason };
    const target = new URL(accepted.address);
    target.pathname = READ_ONLY_INFO_PATH;
    target.search = "";
    target.hash = "";
    target.username = "";
    target.password = "";
    return { method: "GET", url: target };
}

/** IPv4 hosts in the same /24 as a LAN address. Public and loopback ranges are refused. */
export function planLanScanHosts(localAddress: string): string[] | { error: string } {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(localAddress.trim());
    if (!match) return { error: "Scan planning needs an IPv4 LAN address." };
    const octets = match.slice(1).map((part) => Number(part));
    if (octets.some((part) => part > 255)) return { error: "Scan planning needs an IPv4 LAN address." };
    const ip = octets.join(".");
    if (classifyIp(ip) !== "lan") return { error: REJECTED };
    const hosts: string[] = [];
    for (let host = 1; host <= 254; host += 1) {
        const candidate = `${octets[0]}.${octets[1]}.${octets[2]}.${host}`;
        if (candidate !== ip) hosts.push(candidate);
    }
    return hosts;
}
