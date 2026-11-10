// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { discoverLanPrinters, probeServerInfo } from "./lan-discovery";

const INFO = JSON.stringify({
    result: { hostname: "bay-1", klippy_state: "ready", moonraker_version: "v0.8.0" },
});

describe("read-only LAN probe", () => {
    test("probeServerInfo requests GET /server/info and does not follow another path", async () => {
        const calls: { url: string; method: string }[] = [];
        const body = await probeServerInfo("http://10.1.1.8:7125/printer/print/start", async (url, init) => {
            calls.push({ url: String(url), method: String(init?.method ?? "") });
            return new Response(INFO, { status: 200 });
        });
        expect(calls).toEqual([{ url: "http://10.1.1.8:7125/server/info", method: "GET" }]);
        expect(body).toContain("klippy_state");
        const blocked = await probeServerInfo("http://127.0.0.1:7125", async () => {
            throw new Error("loopback must not be requested");
        });
        expect(blocked).toBeNull();
    });

    test("discoverLanPrinters uses the injected probe and keeps only accepted info", async () => {
        const calls: string[] = [];
        const accepted = await discoverLanPrinters({
            localAddresses: ["10.0.0.2"],
            scanPorts: false,
            mdns: [{ type: "_moonraker._tcp", host: "192.168.4.10", port: 7125 }],
            probe: async (address) => {
                calls.push(address);
                return INFO;
            },
        });
        expect(calls).toEqual([]);
        expect(accepted.map((item) => item.address)).toEqual(["http://192.168.4.10:7125"]);
        expect(accepted[0]?.info).toBeNull();
    });
});
