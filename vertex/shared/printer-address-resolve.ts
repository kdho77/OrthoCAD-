// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// DNS pinning for the shop bridge. The browser bundle does not import this module.

import { lookup as dnsLookup } from "node:dns/promises";
import {
    type AddressPolicy,
    classifyIp,
    productionAddressPolicy,
    testLoopbackAddressPolicy,
} from "./printer-address-policy.js";

const REJECTED = "Printer address is not an approved LAN destination.";

function withDns(base: AddressPolicy, allowLoopback: boolean): AddressPolicy {
    return {
        ...base,
        async resolve(raw) {
            const initial = base.decide(raw);
            if (!initial.ok || initial.pinnedIp) return initial;
            const records = await dnsLookup(initial.host, { all: true, verbatim: true });
            if (records.length === 0) return { ok: false, reason: REJECTED };
            for (const record of records) {
                const kind = classifyIp(record.address);
                if (kind === "blocked" || (kind === "loopback" && !allowLoopback) || kind !== "lan") {
                    return { ok: false, reason: REJECTED };
                }
            }
            const pinned = records[0]?.address;
            if (!pinned) return { ok: false, reason: REJECTED };
            return { ok: true, host: initial.host, port: initial.port, pinnedIp: pinned };
        },
    };
}

export function productionBridgePolicy(): AddressPolicy {
    return withDns(productionAddressPolicy(), false);
}

export function testLoopbackBridgePolicy(): AddressPolicy {
    return withDns(testLoopbackAddressPolicy(), true);
}
