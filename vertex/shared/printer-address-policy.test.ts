// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { classifyIp, productionAddressPolicy, testLoopbackAddressPolicy } from "./printer-address-policy.js";

describe("printer address policy", () => {
    test("production allows private LAN addresses and rejects everything else", () => {
        const policy = productionAddressPolicy();
        expect(policy.decide("http://10.8.0.5:7125").ok).toBe(true);
        expect(policy.decide("http://192.168.50.10:7125/").ok).toBe(true);
        expect(policy.decide("http://172.16.4.4:80").ok).toBe(true);
        for (const raw of [
            "http://127.0.0.1:7125",
            "http://localhost:7125",
            "http://169.254.169.254:80",
            "http://169.254.1.1:7125",
            "http://8.8.8.8:7125",
            "http://user:secret@10.8.0.5:7125",
            "http://10.8.0.5:7125/path?token=secret",
            "ftp://10.8.0.5:7125",
            "http://10.8.0.5",
            "http://10.8.0.5:7125/../etc",
        ]) {
            const decision = policy.decide(raw);
            expect(decision.ok).toBe(false);
            if (!decision.ok) expect(decision.reason).not.toContain("secret");
        }
        expect(classifyIp("::1")).toBe("loopback");
        expect(testLoopbackAddressPolicy().name).toBe("test-loopback");
        expect(testLoopbackAddressPolicy().decide("http://127.0.0.1:9").ok).toBe(true);
        expect(testLoopbackAddressPolicy().decide("http://169.254.169.254:80").ok).toBe(false);
    });
});
