// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Enrollment and bridge credential store. Values kept here are hashes, not proofs.

import {
    type BridgeCredential,
    credentialMatches,
    type EnrollmentRecord,
    issueCredential,
    redeemEnrollment,
    sha256Hex,
} from "./print-bridge-enrollment.js";
import {
    DISCOVERY_AUDIENCE,
    type DiscoveryCandidateRecord,
    type DiscoveryMeta,
    deviceProofHash,
    discoveryProofHash,
    generatePairingCode,
    PAIRING_AUDIENCE,
    PAIRING_TTL_MS,
    PENDING_BRIDGE_NAME,
    PENDING_SHOP_ID,
    pairingCodeHash,
    readDiscoveryMeta,
    readPairingMeta,
} from "./print-bridge-pairing.js";
import { productionAddressPolicy } from "./printer-address-policy.js";

export interface PairingBeginResult {
    ok: true;
    pairingCode: string;
    expiresAt: string;
}

export interface DiscoveryList {
    candidates: Array<DiscoveryCandidateRecord & { bridgeId: string }>;
    lastTest: DiscoveryMeta["lastTest"];
}

export interface BridgeDirectory {
    putEnrollment(record: EnrollmentRecord, options?: { name?: string }): Promise<void>;
    redeem(input: {
        proof: string;
        bridgeId: string;
        origin: string;
        now: Date;
    }): Promise<{ ok: true; credential: string } | { ok: false; reason: string }>;
    authenticate(credential: string, bridgeId: string): Promise<BridgeCredential | null>;
    revoke(bridgeId: string, tenantId: string, at: string): Promise<boolean>;
    touch(bridgeId: string, at: string): Promise<void>;
    findBridge(bridgeId: string): Promise<BridgeCredential | null>;
    beginPairing(input: {
        bridgeId: string;
        deviceProof: string;
        origin: string;
        now: Date;
    }): Promise<PairingBeginResult | { ok: false; reason: "already-enrolled" | "invalid" }>;
    approvePairing(input: {
        code: string;
        tenantId: string;
        shopId: string;
        bridgeName: string;
        now: Date;
        replaceBridgeId?: string;
    }): Promise<{ ok: true; bridgeId: string } | { ok: false; reason: "expired" | "used" | "mismatch" }>;
    pollPairing(input: {
        bridgeId: string;
        deviceProof: string;
        origin: string;
        now: Date;
    }): Promise<
        | { status: "pending" | "expired" | "consumed" }
        | { status: "ready"; credential: string; bridgeId: string }
        | { status: "rejected" }
    >;
    reportDiscovery(input: {
        bridge: BridgeCredential;
        candidates: DiscoveryCandidateRecord[];
        connectionTest?: { address: string; info: DiscoveryCandidateRecord["info"] } | null;
        now: Date;
    }): Promise<void>;
    listDiscovery(tenantId: string): Promise<DiscoveryList>;
    requestConnectionTest(input: {
        tenantId: string;
        bridgeId: string;
        address: string;
        now: Date;
    }): Promise<{ ok: true; address: string } | { ok: false; reason: string }>;
    pendingDiscoveryProbe(bridgeId: string): Promise<{ address: string } | null>;
    listEnrolledBridges(tenantId: string): Promise<{ id: string; name: string }[]>;
}

interface MemoryBridge {
    id: string;
    tenantId: string | null;
    shopId: string;
    name: string;
    credentialHash: string | null;
    revokedAt: string | null;
    lastSeenAt: string | null;
    origin: string;
}

interface MemoryEnrollment {
    record: EnrollmentRecord;
    name?: string;
}

function allowedOrigin(origin: string): boolean {
    if (origin.startsWith("https://")) return true;
    try {
        const url = new URL(origin);
        return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    } catch {
        return false;
    }
}

function sanitizeCandidates(candidates: DiscoveryCandidateRecord[]): DiscoveryCandidateRecord[] {
    const policy = productionAddressPolicy();
    const accepted: DiscoveryCandidateRecord[] = [];
    for (const candidate of candidates) {
        const decision = policy.decide(candidate.address);
        if (!decision.ok) continue;
        if (candidate.address !== `http://${candidate.host}:${candidate.port}`) continue;
        accepted.push({
            host: candidate.host,
            port: candidate.port,
            address: candidate.address,
            source: candidate.source,
            info: candidate.info,
        });
    }
    return accepted;
}

export function memoryBridgeDirectory(): BridgeDirectory & { inspect(): string } {
    const enrollments: MemoryEnrollment[] = [];
    const credentials: BridgeCredential[] = [];
    const bridges: MemoryBridge[] = [];
    const discoveries = new Map<string, { tenantId: string; meta: DiscoveryMeta }>();

    function bridgeById(bridgeId: string): MemoryBridge | undefined {
        return bridges.find((item) => item.id === bridgeId);
    }

    return {
        async putEnrollment(record, options) {
            enrollments.push({ record, name: options?.name?.trim() });
            const existing = bridgeById(record.bridgeId);
            if (existing) {
                existing.tenantId = record.tenantId;
                existing.shopId = record.shopId;
                existing.origin = record.origin;
                if (options?.name?.trim()) existing.name = options.name.trim();
                return;
            }
            bridges.push({
                id: record.bridgeId,
                tenantId: record.tenantId,
                shopId: record.shopId,
                name: options?.name?.trim() || PENDING_BRIDGE_NAME,
                credentialHash: null,
                revokedAt: null,
                lastSeenAt: null,
                origin: record.origin,
            });
        },
        async redeem(input) {
            const record = enrollments.find(
                (item) => item.record.proofHash === sha256Hex(input.proof),
            )?.record;
            if (!record) return { ok: false, reason: "mismatch" };
            const result = redeemEnrollment({ record, ...input });
            if (!result.ok) return result;
            record.usedAt = input.now.toISOString();
            credentials.push(result.stored);
            const bridge = bridgeById(record.bridgeId);
            if (bridge) bridge.credentialHash = result.stored.credentialHash;
            return { ok: true, credential: result.credential };
        },
        async authenticate(credential, bridgeId) {
            const found = credentials.find((item) => item.bridgeId === bridgeId && !item.revokedAt);
            if (!found || !credentialMatches(found, credential)) return null;
            return found;
        },
        async revoke(bridgeId, tenantId, at) {
            const found = credentials.find(
                (item) => item.bridgeId === bridgeId && item.tenantId === tenantId,
            );
            const bridge = bridges.find((item) => item.id === bridgeId && item.tenantId === tenantId);
            if (!found && !bridge) return false;
            if (found) found.revokedAt = at;
            if (bridge) bridge.revokedAt = at;
            return true;
        },
        async touch(bridgeId, at) {
            const found = credentials.find((item) => item.bridgeId === bridgeId);
            if (found) found.lastSeenAt = at;
            const bridge = bridgeById(bridgeId);
            if (bridge) bridge.lastSeenAt = at;
        },
        async findBridge(bridgeId) {
            return credentials.find((item) => item.bridgeId === bridgeId) ?? null;
        },
        async beginPairing(input) {
            const proofHash = deviceProofHash(input.deviceProof);
            if (!proofHash || !allowedOrigin(input.origin)) return { ok: false, reason: "invalid" };
            const enrolled = credentials.find((item) => item.bridgeId === input.bridgeId && !item.revokedAt);
            const bridge = bridgeById(input.bridgeId);
            if (enrolled || (bridge?.credentialHash && !bridge.revokedAt)) {
                return { ok: false, reason: "already-enrolled" };
            }
            const code = generatePairingCode();
            const codeHash = pairingCodeHash(code);
            if (!codeHash) return { ok: false, reason: "invalid" };
            for (let index = enrollments.length - 1; index >= 0; index -= 1) {
                const item = enrollments[index];
                if (!item) continue;
                if (
                    item.record.bridgeId === input.bridgeId &&
                    item.record.audience === PAIRING_AUDIENCE &&
                    !item.record.usedAt
                ) {
                    enrollments.splice(index, 1);
                }
            }
            const expiresAt = new Date(input.now.getTime() + PAIRING_TTL_MS).toISOString();
            const record: EnrollmentRecord = {
                id: crypto.randomUUID(),
                proofHash,
                tenantId: "",
                shopId: PENDING_SHOP_ID,
                bridgeId: input.bridgeId,
                printerIds: [],
                audience: PAIRING_AUDIENCE,
                origin: input.origin,
                expiresAt,
                usedAt: null,
            };
            enrollments.push({
                record,
                name: JSON.stringify({ kind: "pairing", codeHash, approved: false }),
            });
            if (bridge) {
                bridge.origin = input.origin;
                if (!bridge.credentialHash) bridge.name = PENDING_BRIDGE_NAME;
            } else {
                bridges.push({
                    id: input.bridgeId,
                    tenantId: null,
                    shopId: PENDING_SHOP_ID,
                    name: PENDING_BRIDGE_NAME,
                    credentialHash: null,
                    revokedAt: null,
                    lastSeenAt: null,
                    origin: input.origin,
                });
            }
            return { ok: true, pairingCode: code, expiresAt };
        },
        async approvePairing(input) {
            const codeHash = pairingCodeHash(input.code);
            const name = input.bridgeName.trim();
            if (!codeHash || !name || !input.tenantId) return { ok: false, reason: "mismatch" };
            const matches = enrollments.filter((item) => {
                if (item.record.audience !== PAIRING_AUDIENCE) return false;
                const meta = item.name ? readPairingMeta(JSON.parse(item.name) as unknown) : null;
                return meta?.codeHash === codeHash;
            });
            if (matches.length === 0) return { ok: false, reason: "mismatch" };
            const live = matches.find(
                (item) =>
                    !item.record.usedAt && new Date(item.record.expiresAt).getTime() > input.now.getTime(),
            );
            if (!live) {
                return { ok: false, reason: matches.some((item) => item.record.usedAt) ? "used" : "expired" };
            }
            const meta = live.name ? readPairingMeta(JSON.parse(live.name) as unknown) : null;
            if (!meta || meta.approved) return { ok: false, reason: "used" };
            let adoptedBridgeId = live.record.bridgeId;
            if (input.replaceBridgeId) {
                const target =
                    bridges.find(
                        (item) =>
                            item.id === input.replaceBridgeId &&
                            item.tenantId === input.tenantId &&
                            Boolean(item.credentialHash) &&
                            !item.revokedAt,
                    ) ??
                    credentials.find(
                        (item) =>
                            item.bridgeId === input.replaceBridgeId &&
                            item.tenantId === input.tenantId &&
                            !item.revokedAt,
                    );
                if (!target) return { ok: false, reason: "mismatch" };
                adoptedBridgeId = input.replaceBridgeId;
            }
            live.name = JSON.stringify({
                kind: "pairing",
                codeHash,
                approved: true,
                adoptedBridgeId,
            });
            live.record.tenantId = input.tenantId;
            live.record.shopId = input.shopId;
            const bridge = bridgeById(live.record.bridgeId);
            if (bridge) {
                bridge.tenantId = input.tenantId;
                bridge.shopId = input.shopId;
                bridge.name = name;
            }
            return { ok: true, bridgeId: adoptedBridgeId };
        },
        async pollPairing(input) {
            const proofHash = deviceProofHash(input.deviceProof);
            if (!proofHash) return { status: "rejected" };
            const live = enrollments.find(
                (item) =>
                    item.record.audience === PAIRING_AUDIENCE &&
                    item.record.proofHash === proofHash &&
                    item.record.bridgeId === input.bridgeId &&
                    item.record.origin === input.origin,
            );
            if (!live) return { status: "rejected" };
            if (live.record.usedAt) return { status: "consumed" };
            if (new Date(live.record.expiresAt).getTime() <= input.now.getTime())
                return { status: "expired" };
            const meta = live.name ? readPairingMeta(JSON.parse(live.name) as unknown) : null;
            if (!meta?.approved || !live.record.tenantId || live.record.shopId === PENDING_SHOP_ID) {
                return { status: "pending" };
            }
            const issued = issueCredential();
            live.record.usedAt = input.now.toISOString();
            const bridgeId = meta.adoptedBridgeId || live.record.bridgeId;
            const stored: BridgeCredential = {
                bridgeId,
                tenantId: live.record.tenantId,
                shopId: live.record.shopId,
                printerIds: [],
                credentialHash: issued.credentialHash,
                revokedAt: null,
                lastSeenAt: null,
                origin: live.record.origin,
            };
            const existing = credentials.find((item) => item.bridgeId === bridgeId && !item.revokedAt);
            if (existing) existing.credentialHash = issued.credentialHash;
            else credentials.push(stored);
            const bridge = bridgeById(bridgeId) ?? bridgeById(live.record.bridgeId);
            if (bridge && bridge.id === bridgeId) bridge.credentialHash = issued.credentialHash;
            return { status: "ready", credential: issued.credential, bridgeId };
        },
        async reportDiscovery(input) {
            const candidates = sanitizeCandidates(input.candidates);
            const current = discoveries.get(input.bridge.bridgeId);
            const meta: DiscoveryMeta = current?.meta ?? {
                kind: "discovery",
                candidates: [],
                probe: null,
                lastTest: null,
            };
            meta.candidates = candidates;
            if (input.connectionTest && meta.probe && meta.probe.address === input.connectionTest.address) {
                meta.lastTest = {
                    address: input.connectionTest.address,
                    info: input.connectionTest.info,
                    checkedAt: input.now.toISOString(),
                };
                meta.probe = null;
            }
            discoveries.set(input.bridge.bridgeId, { tenantId: input.bridge.tenantId, meta });
        },
        async listDiscovery(tenantId) {
            const candidates: DiscoveryList["candidates"] = [];
            let lastTest: DiscoveryMeta["lastTest"] = null;
            for (const [bridgeId, entry] of discoveries) {
                if (entry.tenantId !== tenantId) continue;
                for (const candidate of entry.meta.candidates) candidates.push({ ...candidate, bridgeId });
                if (entry.meta.lastTest) lastTest = entry.meta.lastTest;
            }
            return { candidates, lastTest };
        },
        async requestConnectionTest(input) {
            const bridge = credentials.find(
                (item) =>
                    item.bridgeId === input.bridgeId && item.tenantId === input.tenantId && !item.revokedAt,
            );
            if (!bridge) return { ok: false, reason: "Bridge not found." };
            const decision = productionAddressPolicy().decide(input.address);
            if (!decision.ok) return { ok: false, reason: decision.reason };
            const current = discoveries.get(input.bridgeId);
            const meta: DiscoveryMeta = current?.meta ?? {
                kind: "discovery",
                candidates: [],
                probe: null,
                lastTest: null,
            };
            meta.probe = {
                address: decision.pinnedIp ? input.address : input.address,
                requestedAt: input.now.toISOString(),
            };
            discoveries.set(input.bridgeId, { tenantId: input.tenantId, meta });
            return { ok: true, address: input.address };
        },
        async pendingDiscoveryProbe(bridgeId) {
            const probe = discoveries.get(bridgeId)?.meta.probe;
            return probe ? { address: probe.address } : null;
        },
        async listEnrolledBridges(tenantId) {
            const seen = new Set<string>();
            const rows: { id: string; name: string }[] = [];
            for (const bridge of bridges) {
                if (bridge.tenantId !== tenantId || !bridge.credentialHash || bridge.revokedAt) continue;
                seen.add(bridge.id);
                rows.push({ id: bridge.id, name: bridge.name });
            }
            for (const credential of credentials) {
                if (credential.tenantId !== tenantId || credential.revokedAt || seen.has(credential.bridgeId))
                    continue;
                rows.push({ id: credential.bridgeId, name: credential.bridgeId.slice(0, 8) });
            }
            return rows;
        },
        inspect() {
            return JSON.stringify({
                enrollments,
                credentials,
                bridges,
                discoveries: [...discoveries.values()],
            });
        },
    };
}

export function pairingMetaFromName(name: string | undefined): ReturnType<typeof readPairingMeta> {
    if (!name) return null;
    try {
        return readPairingMeta(JSON.parse(name) as unknown);
    } catch {
        return null;
    }
}

export { DISCOVERY_AUDIENCE, discoveryProofHash, readDiscoveryMeta };
