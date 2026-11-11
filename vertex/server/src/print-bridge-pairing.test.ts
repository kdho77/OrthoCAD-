// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, test } from "@rstest/core";
import { memoryBridgeDirectory } from "../../shared/print-bridge-directory";
import { createEnrollment, sha256Hex } from "../../shared/print-bridge-enrollment";
import { containsSecret } from "../../shared/print-bridge-pairing";
import { createMemoryProductionRepo } from "../../shared/production-jobs";
import { handlePrintBridgeNode } from "./print-bridge-http";

const ORIGIN = "https://cloud.example";
const TENANT = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-10T12:00:00.000Z");

function invoke(
    directory: ReturnType<typeof memoryBridgeDirectory>,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
    const payload = Buffer.from(JSON.stringify(body));
    const req = Readable.from([payload]) as IncomingMessage;
    req.method = "POST";
    req.url = path;
    req.headers = headers;
    let status = 0;
    const chunks: Buffer[] = [];
    const res = {
        writeHead(code: number) {
            status = code;
            return this;
        },
        end(part?: string | Buffer) {
            if (part) chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
        },
    } as unknown as ServerResponse;
    return handlePrintBridgeNode(req, res, {
        directory,
        repo: createMemoryProductionRepo({ jobs: [], printers: [], gcode: {} }),
        now: () => NOW,
    }).then(() => {
        const text = Buffer.concat(chunks).toString("utf8");
        return { status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
    });
}

describe("print bridge pairing http", () => {
    test("approval delivers one credential and rejected codes do not", async () => {
        const directory = memoryBridgeDirectory();
        const bridgeId = "5598afcd-1111-4111-8111-111111111111";
        const deviceProof = "deviceProofSecretValueNotStoredAnywhere32";
        const logs: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => {
            logs.push(args.map((item) => String(item)).join(" "));
        };
        try {
            const began = await invoke(directory, "/print-bridge/v1/pair/begin", {
                bridgeId,
                deviceProof,
                origin: ORIGIN,
            });
            expect(began.status).toBe(201);
            const code = String(began.json.pairingCode ?? "");
            const pending = await invoke(directory, "/print-bridge/v1/pair/poll", {
                bridgeId,
                deviceProof,
                origin: ORIGIN,
            });
            expect(pending.json).toEqual({ status: "pending" });
            const approved = await directory.approvePairing({
                code,
                tenantId: TENANT,
                shopId: TENANT,
                bridgeName: "Shop computer",
                now: NOW,
            });
            expect(approved).toEqual({ ok: true, bridgeId });
            const ready = await invoke(directory, "/print-bridge/v1/pair/poll", {
                bridgeId,
                deviceProof,
                origin: ORIGIN,
            });
            expect(ready.status).toBe(200);
            expect(ready.json.status).toBe("ready");
            const credential = String(ready.json.credential ?? "");
            const again = await invoke(directory, "/print-bridge/v1/pair/poll", {
                bridgeId,
                deviceProof,
                origin: ORIGIN,
            });
            expect(again.json).toEqual({ status: "consumed" });
            const expired = await directory.beginPairing({
                bridgeId: "11111111-1111-4111-8111-111111111112",
                deviceProof: "secondDeviceProofSecretValueNotStored77",
                origin: ORIGIN,
                now: new Date("2026-11-10T11:00:00.000Z"),
            });
            if (!expired.ok) throw new Error("second pairing did not start");
            expect(
                await directory.approvePairing({
                    code: expired.pairingCode,
                    tenantId: TENANT,
                    shopId: TENANT,
                    bridgeName: "Late",
                    now: NOW,
                }),
            ).toEqual({ ok: false, reason: "expired" });
            const rendered = JSON.stringify({ logs, stored: directory.inspect(), approved, again });
            expect(containsSecret(rendered, deviceProof)).toBe(false);
            expect(containsSecret(rendered, credential)).toBe(false);
            expect(directory.inspect()).toContain(sha256Hex(credential));
        } finally {
            console.error = original;
        }
    });

    test("a legacy bearer heartbeat still authenticates without pairing", async () => {
        const directory = memoryBridgeDirectory();
        const created = createEnrollment({
            tenantId: TENANT,
            shopId: TENANT,
            bridgeId: "5598afcd-2222-4222-8222-222222222222",
            printerIds: [],
            origin: ORIGIN,
            now: NOW,
        });
        await directory.putEnrollment(created.record, { name: "Existing press" });
        const enrolled = await invoke(directory, "/print-bridge/v1/enroll", {
            proof: created.proof,
            bridgeId: created.record.bridgeId,
            origin: ORIGIN,
        });
        expect(enrolled.status).toBe(201);
        const credential = String(enrolled.json.credential ?? "");
        const forced = await invoke(directory, "/print-bridge/v1/pair/begin", {
            bridgeId: created.record.bridgeId,
            deviceProof: "deviceProofSecretValueNotStoredAnywhere32",
            origin: ORIGIN,
        });
        expect(forced.status).toBe(409);
        const beat = await invoke(
            directory,
            "/print-bridge/v1/heartbeat",
            { bridgeId: created.record.bridgeId },
            { authorization: `Bearer ${credential}` },
        );
        expect(beat.status).toBe(200);
        expect(beat.json.discoveryProbe).toBeUndefined();
        expect(Array.isArray(beat.json.printers)).toBe(true);
        const stored = directory.inspect();
        expect(containsSecret(stored, created.proof)).toBe(false);
        expect(containsSecret(stored, credential)).toBe(false);
    });

    test("approval can attach the computer to an already enrolled bridge", async () => {
        const directory = memoryBridgeDirectory();
        const existingId = "5598afcd-2222-4222-8222-222222222222";
        const created = createEnrollment({
            tenantId: TENANT,
            shopId: TENANT,
            bridgeId: existingId,
            printerIds: [],
            origin: ORIGIN,
            now: NOW,
        });
        await directory.putEnrollment(created.record, { name: "Existing press" });
        const enrolled = await invoke(directory, "/print-bridge/v1/enroll", {
            proof: created.proof,
            bridgeId: existingId,
            origin: ORIGIN,
        });
        const previous = String(enrolled.json.credential ?? "");
        const freshId = "33333333-3333-4333-8333-333333333333";
        const deviceProof = "freshDeviceProofSecretValueNotStoredAnywhere1";
        const began = await invoke(directory, "/print-bridge/v1/pair/begin", {
            bridgeId: freshId,
            deviceProof,
            origin: ORIGIN,
        });
        const approved = await directory.approvePairing({
            code: String(began.json.pairingCode ?? ""),
            tenantId: TENANT,
            shopId: TENANT,
            bridgeName: "Replacement computer",
            now: NOW,
            replaceBridgeId: existingId,
        });
        expect(approved).toEqual({ ok: true, bridgeId: existingId });
        const ready = await invoke(directory, "/print-bridge/v1/pair/poll", {
            bridgeId: freshId,
            deviceProof,
            origin: ORIGIN,
        });
        expect(ready.json.bridgeId).toBe(existingId);
        const next = String(ready.json.credential ?? "");
        expect(await directory.authenticate(previous, existingId)).toBeNull();
        expect(await directory.authenticate(next, existingId)).not.toBeNull();
        expect(await directory.authenticate(next, freshId)).toBeNull();
        const rendered = directory.inspect();
        expect(containsSecret(rendered, previous)).toBe(false);
        expect(containsSecret(rendered, next)).toBe(false);
        expect(containsSecret(rendered, deviceProof)).toBe(false);
    });
});
