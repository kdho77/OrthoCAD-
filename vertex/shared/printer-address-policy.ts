// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// LAN address policy for operator-configured Moonraker printers.
// Production rejects loopback, link-local, metadata, and public hosts.
// Test loopback is a separate function. Production code must not call it.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type AddressDecision =
    | { ok: true; host: string; port: number; pinnedIp: string | null }
    | { ok: false; reason: string };

export interface AddressPolicy {
    readonly name: "production" | "test-loopback";
    readonly allowLoopback: boolean;
    decide(raw: string): AddressDecision;
    resolve(raw: string): Promise<AddressDecision>;
}

const REJECTED = "Printer address is not an approved LAN destination.";

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const octet = Number(part);
        if (octet > 255) return null;
        value = (value << 8) | octet;
    }
    return value >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
    const address = ipv4ToInt(ip);
    const network = ipv4ToInt(base);
    if (address == null || network == null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (address & mask) === (network & mask);
}

export function classifyIp(ip: string): "lan" | "loopback" | "blocked" {
    const mapped = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
    if (mapped === "::1" || mapped === "0:0:0:0:0:0:0:1") return "loopback";
    const v4 = isIP(mapped) === 4 ? mapped : null;
    if (!v4) {
        const lower = mapped.toLowerCase();
        if (lower.startsWith("fe80:") || lower.startsWith("fe80")) return "blocked";
        if (lower.startsWith("fc") || lower.startsWith("fd")) return "lan";
        return "blocked";
    }
    if (v4 === "169.254.169.254") return "blocked";
    if (inCidr(v4, "127.0.0.0", 8)) return "loopback";
    if (inCidr(v4, "0.0.0.0", 8)) return "blocked";
    if (inCidr(v4, "169.254.0.0", 16)) return "blocked";
    if (inCidr(v4, "224.0.0.0", 4)) return "blocked";
    if (inCidr(v4, "10.0.0.0", 8) || inCidr(v4, "192.168.0.0", 16) || inCidr(v4, "172.16.0.0", 12))
        return "lan";
    return "blocked";
}

function parsePrinterUrl(
    raw: string,
): { host: string; port: number; protocol: "http:" | "https:" } | { error: string } {
    const trimmed = raw.trim();
    if (!trimmed) return { error: "Printer address is required." };
    if (trimmed.includes("..") || trimmed.includes("\\")) return { error: REJECTED };
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return { error: "Printer address must be an http(s) URL with a host and port." };
    }
    if (url.username || url.password)
        return { error: "Printer address must not include a username or password." };
    if (url.search || url.hash) return { error: "Printer address must not include a query or fragment." };
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: REJECTED };
    const declaredPort = /:(\d+)(?:[/?#]|$)/.exec(trimmed);
    if (!declaredPort) return { error: "Printer address must include an explicit port." };
    const port = Number(declaredPort[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Printer port is invalid." };
    if (url.pathname.includes("..") || url.pathname.includes("\\") || url.pathname.includes("//")) {
        return { error: REJECTED };
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host || host.toLowerCase() === "localhost") return { error: REJECTED };
    return { host, port, protocol: url.protocol };
}

function decideHost(host: string, port: number, allowLoopback: boolean): AddressDecision {
    const kind = isIP(host) ? classifyIp(host) : null;
    if (kind === "blocked" || (kind === "loopback" && !allowLoopback)) return { ok: false, reason: REJECTED };
    if (kind === "loopback" && allowLoopback) return { ok: true, host, port, pinnedIp: host };
    if (kind === "lan") return { ok: true, host, port, pinnedIp: host };
    if (isIP(host)) return { ok: false, reason: REJECTED };
    if (!/^[a-z0-9.-]+$/i.test(host)) return { ok: false, reason: REJECTED };
    return { ok: true, host, port, pinnedIp: null };
}

export function productionAddressPolicy(): AddressPolicy {
    return {
        name: "production",
        allowLoopback: false,
        decide(raw) {
            const parsed = parsePrinterUrl(raw);
            if ("error" in parsed) return { ok: false, reason: parsed.error };
            return decideHost(parsed.host, parsed.port, false);
        },
        async resolve(raw) {
            const parsed = parsePrinterUrl(raw);
            if ("error" in parsed) return { ok: false, reason: parsed.error };
            const initial = decideHost(parsed.host, parsed.port, false);
            if (!initial.ok || initial.pinnedIp) return initial;
            const records = await dnsLookup(parsed.host, { all: true, verbatim: true });
            if (records.length === 0) return { ok: false, reason: REJECTED };
            for (const record of records) {
                const kind = classifyIp(record.address);
                if (kind !== "lan") return { ok: false, reason: REJECTED };
            }
            const pinned = records[0]?.address;
            if (!pinned) return { ok: false, reason: REJECTED };
            return { ok: true, host: parsed.host, port: parsed.port, pinnedIp: pinned };
        },
    };
}

/** Test-only. Production main must not call this. It still rejects metadata and public hosts. */
export function testLoopbackAddressPolicy(): AddressPolicy {
    return {
        name: "test-loopback",
        allowLoopback: true,
        decide(raw) {
            const parsed = parsePrinterUrl(raw);
            if ("error" in parsed) return { ok: false, reason: parsed.error };
            return decideHost(parsed.host, parsed.port, true);
        },
        async resolve(raw) {
            const parsed = parsePrinterUrl(raw);
            if ("error" in parsed) return { ok: false, reason: parsed.error };
            const initial = decideHost(parsed.host, parsed.port, true);
            if (!initial.ok || initial.pinnedIp) return initial;
            const records = await dnsLookup(parsed.host, { all: true, verbatim: true });
            for (const record of records) {
                const kind = classifyIp(record.address);
                if (kind === "blocked" || kind === "loopback") return { ok: false, reason: REJECTED };
                if (kind !== "lan") return { ok: false, reason: REJECTED };
            }
            const pinned = records[0]?.address ?? null;
            return pinned
                ? { ok: true, host: parsed.host, port: parsed.port, pinnedIp: pinned }
                : { ok: false, reason: REJECTED };
        },
    };
}

export function assertPinned(previous: string | null, next: string): void {
    if (previous && previous !== next) {
        throw new Error("Printer address resolution changed. The connection was not opened.");
    }
}
