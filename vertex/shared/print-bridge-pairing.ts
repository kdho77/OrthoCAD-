// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Browser pairing for the shop print bridge.
// The short code is shown to an admin. It is not a credential.
// Device proofs and bridge credentials are stored only as sha256 hashes.

import { randomBytes } from "node:crypto";
import { sha256Hex } from "./print-bridge-enrollment.js";

export const PAIRING_AUDIENCE = "orthocad-print-bridge-pair";
export const DISCOVERY_AUDIENCE = "orthocad-print-bridge-discovery";
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PENDING_SHOP_ID = "pending";
export const PENDING_BRIDGE_NAME = "Waiting for approval";

/** Unambiguous alphabet: no 0/O or 1/I. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CODE_BODY = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export interface PairingMeta {
    kind: "pairing";
    codeHash: string;
    approved: boolean;
}

export interface DiscoveryProbe {
    address: string;
    requestedAt: string;
}

export interface DiscoveryCandidateRecord {
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

export interface DiscoveryMeta {
    kind: "discovery";
    candidates: DiscoveryCandidateRecord[];
    probe: DiscoveryProbe | null;
    lastTest: { address: string; info: DiscoveryCandidateRecord["info"]; checkedAt: string } | null;
}

export function generatePairingCode(random: (size: number) => Buffer = randomBytes): string {
    const bytes = random(8);
    let body = "";
    for (const byte of bytes) body += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
    return `${body.slice(0, 4)}-${body.slice(4)}`;
}

export function normalizePairingCode(input: string): string | null {
    const body = input
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "");
    if (!CODE_BODY.test(body)) return null;
    return `${body.slice(0, 4)}-${body.slice(4)}`;
}

export function pairingCodeHash(code: string): string | null {
    const normalized = normalizePairingCode(code);
    if (!normalized) return null;
    return sha256Hex(normalized);
}

export function deviceProofHash(deviceProof: string): string | null {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(deviceProof)) return null;
    return sha256Hex(deviceProof);
}

export function readPairingMeta(value: unknown): PairingMeta | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const kind = "kind" in value ? value.kind : null;
    const codeHash = "codeHash" in value ? value.codeHash : null;
    const approved = "approved" in value ? value.approved : null;
    if (kind !== "pairing" || typeof codeHash !== "string" || codeHash.length !== 64) return null;
    if (typeof approved !== "boolean") return null;
    return { kind: "pairing", codeHash, approved };
}

export function readDiscoveryMeta(value: unknown): DiscoveryMeta | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!("kind" in value) || value.kind !== "discovery") return null;
    const candidates = "candidates" in value && Array.isArray(value.candidates) ? value.candidates : [];
    const parsed: DiscoveryCandidateRecord[] = [];
    for (const item of candidates) {
        const candidate = readCandidate(item);
        if (candidate) parsed.push(candidate);
    }
    const probe = "probe" in value ? readProbe(value.probe) : null;
    const lastTest = "lastTest" in value ? readLastTest(value.lastTest) : null;
    return { kind: "discovery", candidates: parsed, probe, lastTest };
}

function readCandidate(value: unknown): DiscoveryCandidateRecord | null {
    if (!value || typeof value !== "object") return null;
    const host = "host" in value && typeof value.host === "string" ? value.host : "";
    const port = "port" in value && typeof value.port === "number" ? value.port : 0;
    const address = "address" in value && typeof value.address === "string" ? value.address : "";
    const source =
        "source" in value && (value.source === "mdns" || value.source === "scan") ? value.source : null;
    if (!host || !source || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (address !== `http://${host}:${port}`) return null;
    const info = "info" in value ? readInfo(value.info) : null;
    return { host, port, address, source, info };
}

function readInfo(value: unknown): DiscoveryCandidateRecord["info"] {
    if (!value || typeof value !== "object") return null;
    const text = (key: string): string | null => {
        if (!(key in value)) return null;
        const item = (value as Record<string, unknown>)[key];
        return typeof item === "string" && item.length > 0 && item.length <= 120 ? item : null;
    };
    return {
        hostname: text("hostname"),
        moonrakerVersion: text("moonrakerVersion"),
        klippyState: text("klippyState"),
        apiVersion: text("apiVersion"),
    };
}

function readProbe(value: unknown): DiscoveryProbe | null {
    if (!value || typeof value !== "object") return null;
    const address = "address" in value && typeof value.address === "string" ? value.address : "";
    const requestedAt =
        "requestedAt" in value && typeof value.requestedAt === "string" ? value.requestedAt : "";
    if (!address || !requestedAt) return null;
    return { address, requestedAt };
}

function readLastTest(value: unknown): DiscoveryMeta["lastTest"] {
    if (!value || typeof value !== "object") return null;
    const address = "address" in value && typeof value.address === "string" ? value.address : "";
    const checkedAt = "checkedAt" in value && typeof value.checkedAt === "string" ? value.checkedAt : "";
    if (!address || !checkedAt) return null;
    return { address, info: readInfo("info" in value ? value.info : null), checkedAt };
}

export function discoveryProofHash(bridgeId: string): string {
    return sha256Hex(`discovery:${bridgeId}`);
}

export function containsSecret(blob: string, secret: string): boolean {
    return secret.length > 0 && blob.includes(secret);
}
