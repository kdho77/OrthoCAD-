// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    acceptDiscoveryAddress,
    collectDiscoveryCandidates,
    planLanScanHosts,
    READ_ONLY_INFO_PATH,
    readOnlyInfoRequest,
    summarizeServerInfo,
} from "./print-bridge-discovery";
import { productionAddressPolicy, testLoopbackAddressPolicy } from "./printer-address-policy";

const INFO = JSON.stringify({
    result: {
        hostname: "bay-1",
        klippy_state: "ready",
        moonraker_version: "v0.8.0",
        api_version_string: "1.4.0",
    },
});

describe("moonraker discovery parsing", () => {
    test("mDNS and port 7125 hits become LAN candidates with a server info summary", () => {
        const policy = productionAddressPolicy();
        const result = collectDiscoveryCandidates(
            {
                mdns: [
                    { type: "_moonraker._tcp.local", host: "printer.local", port: 7125, name: "Bay" },
                    { type: "_http._tcp", host: "192.168.1.20", port: 80 },
                ],
                scans: [
                    { host: "192.168.1.20", port: 7125, infoBody: INFO },
                    { host: "192.168.1.21", port: 7125, infoBody: INFO },
                ],
            },
            policy,
        );
        expect(result.accepted.map((item) => item.address)).toEqual([
            "http://printer.local:7125",
            "http://192.168.1.20:7125",
            "http://192.168.1.21:7125",
        ]);
        const bay = result.accepted.find((item) => item.host === "192.168.1.20");
        expect(bay?.source).toBe("scan");
        expect(bay?.info).toEqual({
            hostname: "bay-1",
            moonrakerVersion: "v0.8.0",
            klippyState: "ready",
            apiVersion: "1.4.0",
        });
        expect(result.rejected.some((item) => item.reason.includes("not a Moonraker"))).toBe(true);
    });

    test("non-LAN and policy-violating addresses are rejected", () => {
        const policy = productionAddressPolicy();
        const rejected = [
            ["127.0.0.1", 7125],
            ["169.254.1.5", 7125],
            ["169.254.169.254", 7125],
            ["8.8.8.8", 7125],
            ["printer.example", 7125],
            ["user:pass@192.168.1.20", 7125],
        ] as const;
        for (const [host, port] of rejected) {
            const decision = acceptDiscoveryAddress(host, port, policy);
            expect(decision.ok).toBe(false);
        }
        const result = collectDiscoveryCandidates(
            {
                mdns: [],
                scans: [
                    { host: "8.8.8.8", port: 7125, infoBody: INFO },
                    { host: "192.168.1.20", port: 7125, infoBody: null },
                    { host: "192.168.1.20", port: 80, infoBody: INFO },
                    { host: "10.0.0.8", port: 7125, infoBody: "not-json" },
                ],
            },
            policy,
        );
        expect(result.accepted).toEqual([]);
        expect(result.rejected.map((item) => item.reason)).toEqual([
            "Printer address is not an approved LAN destination.",
            "Printer info was not returned.",
            "Port scan only accepts Moonraker port 7125.",
            "Printer info was malformed.",
        ]);
    });

    test("the connection test builds a read-only GET /server/info and scan plans stay on the LAN", () => {
        const request = readOnlyInfoRequest("http://10.1.4.9:7125/extra", productionAddressPolicy());
        if ("error" in request) throw new Error(request.error);
        expect(request.method).toBe("GET");
        expect(request.url.pathname).toBe(READ_ONLY_INFO_PATH);
        expect(request.url.search).toBe("");
        expect(request.url.username).toBe("");
        expect(readOnlyInfoRequest("http://127.0.0.1:7125", productionAddressPolicy())).toEqual({
            error: "Printer address is not an approved LAN destination.",
        });
        const loopback = readOnlyInfoRequest("http://127.0.0.1:7125", testLoopbackAddressPolicy());
        if ("error" in loopback) throw new Error(loopback.error);
        expect(loopback.method).toBe("GET");
        const hosts = planLanScanHosts("192.168.9.4");
        expect(Array.isArray(hosts)).toBe(true);
        if (!Array.isArray(hosts)) return;
        expect(hosts).toHaveLength(253);
        expect(hosts).not.toContain("192.168.9.4");
        expect(hosts[0]).toBe("192.168.9.1");
        expect(planLanScanHosts("8.8.8.8")).toEqual({
            error: "Printer address is not an approved LAN destination.",
        });
        expect(summarizeServerInfo(INFO)).toMatchObject({ hostname: "bay-1", klippyState: "ready" });
    });
});
