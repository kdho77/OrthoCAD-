// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Enrollment and bridge credential store. Values kept here are hashes, not proofs.

import {
    type BridgeCredential,
    credentialMatches,
    type EnrollmentRecord,
    redeemEnrollment,
    sha256Hex,
} from "./print-bridge-enrollment.js";

export interface BridgeDirectory {
    putEnrollment(record: EnrollmentRecord): Promise<void>;
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
}

export function memoryBridgeDirectory(): BridgeDirectory {
    const enrollments: EnrollmentRecord[] = [];
    const credentials: BridgeCredential[] = [];
    return {
        async putEnrollment(record) {
            enrollments.push(record);
        },
        async redeem(input) {
            const record = enrollments.find((item) => item.proofHash === sha256Hex(input.proof));
            if (!record) return { ok: false, reason: "mismatch" };
            const result = redeemEnrollment({ record, ...input });
            if (!result.ok) return result;
            record.usedAt = input.now.toISOString();
            credentials.push(result.stored);
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
            if (!found) return false;
            found.revokedAt = at;
            return true;
        },
        async touch(bridgeId, at) {
            const found = credentials.find((item) => item.bridgeId === bridgeId);
            if (found) found.lastSeenAt = at;
        },
        async findBridge(bridgeId) {
            return credentials.find((item) => item.bridgeId === bridgeId) ?? null;
        },
    };
}
