// Gate A. A both-feet production whose loft stub blocks longer than 5 s must not
// hit a Prisma interactive-transaction timeout or surface "Manufacturing timed out".
// The loft stub replaces materialize. The real loft and slicer are not called.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { PrismaClient } from "@prisma/client";

const LOFT_BLOCK_MS = 6_000;
const INTERACTIVE_TIMEOUT_MS = 5_000;
const FIXTURE_GCODE = "G90\nG1 X10 Y0 Z0.2\n";
const FIXTURE_STL = {
    left: "stl/cad-operator/gate/left.stl",
    right: "stl/cad-operator/gate/right.stl",
} as const;
const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDS = {
    left: "11111111-1111-4111-8111-111111111111",
    right: "22222222-2222-4222-8222-222222222222",
} as const;

type Stored = Record<string, unknown>;

export interface PairPrismaHandle {
    prisma: PrismaClient;
    transactions: () => number;
    openTransactions: () => number;
    maxElapsedMs: () => number;
}

function sameStoredValue(actual: unknown, expected: unknown): boolean {
    if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
    return actual === expected;
}

function blockEventLoop(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // Synchronous stand-in for the other foot's loft. Do not call the real loft.
    }
}

export function createPairPrisma(): PairPrismaHandle {
    const rows = new Map<string, Stored>();
    let transactions = 0;
    let openTransactions = 0;
    let maxElapsedMs = 0;

    function read(where: { id?: string }): Stored | null {
        if (!where.id) return null;
        const row = rows.get(where.id);
        return row ? { ...row } : null;
    }

    const production = {
        async create({ data }: { data: Stored }) {
            const row: Stored = {
                id: data.id,
                designId: data.designId,
                side: data.side ?? null,
                presetId: data.presetId,
                status: data.status,
                idempotencyKey: data.idempotencyKey ?? null,
                settingsFingerprint: data.settingsFingerprint ?? null,
                gcodeStorageKey: data.gcodeStorageKey ?? null,
                error: data.error ?? null,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
                leaseExpiresAt: data.leaseExpiresAt ?? null,
                chargedAt: data.chargedAt ?? null,
                exportId: data.exportId ?? null,
                method: data.method,
                beltAngleDeg: data.beltAngleDeg ?? null,
                layerHeightMm: data.layerHeightMm ?? null,
                material: data.material ?? null,
            };
            rows.set(String(row.id), row);
            return { ...row };
        },
        async findUnique({ where }: { where: { id?: string } }) {
            return read(where);
        },
        async updateMany({ where, data }: { where: Stored; data: Stored }) {
            const current = rows.get(String(where.id));
            if (!current) return { count: 0 };
            const matches = Object.entries(where).every(([key, value]) =>
                sameStoredValue(current[key], value),
            );
            if (!matches) return { count: 0 };
            for (const [key, value] of Object.entries(data)) {
                if (value !== undefined) current[key] = value;
            }
            return { count: 1 };
        },
        async update({ where, data }: { where: { id: string }; data: Stored }) {
            const current = rows.get(where.id);
            if (!current) throw new Error("missing production");
            for (const [key, value] of Object.entries(data)) {
                if (value !== undefined) current[key] = value;
            }
            return { ...current };
        },
    };

    const prisma = {
        production,
        async $transaction(fn: (tx: unknown) => Promise<unknown>, options?: { timeout?: number }) {
            transactions += 1;
            openTransactions += 1;
            const started = Date.now();
            const timeout = options?.timeout ?? INTERACTIVE_TIMEOUT_MS;
            const assertWithinTimeout = () => {
                const elapsed = Date.now() - started;
                if (elapsed > maxElapsedMs) maxElapsedMs = elapsed;
                if (elapsed > timeout) {
                    throw new Error(
                        `Transaction already closed: The timeout for this transaction was ${timeout} ms, however ${elapsed} ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.`,
                    );
                }
            };
            const tx = {
                async $queryRaw() {
                    await new Promise((resolvePromise) => setImmediate(resolvePromise));
                    assertWithinTimeout();
                    return [{ id: "locked" }];
                },
                production: {
                    async findUnique(args: { where: { id?: string } }) {
                        await new Promise((resolvePromise) => setImmediate(resolvePromise));
                        assertWithinTimeout();
                        return production.findUnique(args);
                    },
                    async update(args: { where: { id: string }; data: Stored }) {
                        await new Promise((resolvePromise) => setImmediate(resolvePromise));
                        assertWithinTimeout();
                        return production.update(args);
                    },
                },
            };
            try {
                const result = await fn(tx);
                assertWithinTimeout();
                return result;
            } finally {
                openTransactions -= 1;
            }
        },
    };

    return {
        prisma: prisma as unknown as PrismaClient,
        transactions: () => transactions,
        openTransactions: () => openTransactions,
        maxElapsedMs: () => maxElapsedMs,
    };
}

function productRoot(): string {
    return resolve(process.env.ORTHOCAD_ROOT ?? new URL("../../", import.meta.url).pathname);
}

function row(side: "left" | "right", now: Date) {
    return {
        id: IDS[side],
        designId: DESIGN_ID,
        side,
        presetId: "apex-v2-insole-95a",
        status: "pending" as const,
        idempotencyKey: `cadop:v1:gate:${side}`,
        settingsFingerprint: "fp-gate",
        gcodeStorageKey: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        chargedAt: null,
        exportId: null,
        method: "printing_solid" as const,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

async function selfTest(): Promise<number> {
    const handle = createPairPrisma();
    let message = "";
    try {
        await handle.prisma.$transaction(async (tx) => {
            await tx.$queryRaw``;
            blockEventLoop(LOFT_BLOCK_MS);
            await tx.production.update({
                where: { id: "none" },
                data: { status: "running" },
            });
            return null;
        });
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    const rejected = /Transaction already closed/.test(message) && /5000 ms/.test(message);
    const result = {
        pass: rejected,
        summary: rejected
            ? `self-test rejected long work inside a ${INTERACTIVE_TIMEOUT_MS} ms interactive transaction (elapsed ${handle.maxElapsedMs()} ms)`
            : `self-test did not reject long work inside the transaction: ${message || "no error"}`,
        measured: {
            elapsed_ms: handle.maxElapsedMs(),
            threshold_ms: INTERACTIVE_TIMEOUT_MS,
            message,
        },
    };
    finish(result);
    return rejected ? 0 : 1;
}

function finish(result: { pass: boolean; summary: string; measured: unknown }): void {
    const path = process.env.GATE_RESULT_PATH;
    if (path) writeFileSync(path, JSON.stringify(result, null, 2));
    console.log(result.summary);
}

async function main(): Promise<number> {
    if (process.argv.includes("--self-test")) return selfTest();

    const root = productRoot();
    const storeUrl = pathToFileURL(
        resolve(root, "vertex/server/src/lib/cad-operator-production-prisma.ts"),
    ).href;
    const execUrl = pathToFileURL(resolve(root, "vertex/server/src/lib/cad-operator-production.ts")).href;
    const storeMod = await import(storeUrl);
    const execMod = await import(execUrl);
    const handle = createPairPrisma();
    const store = new storeMod.PrismaCadProductionStore(handle.prisma);
    const created = new Date("2026-11-24T17:16:00.000Z");
    const uploaded = new Map<"left" | "right", string>();
    const loftMs: Record<string, number> = {};
    let openDuringLoft = false;
    const thrown: string[] = [];

    await store.insert(row("left", created));
    await store.insert(row("right", created));
    const left = await store.findById(IDS.left);
    const right = await store.findById(IDS.right);
    if (!left || !right) throw new Error("pair rows missing");

    const run = (current: typeof left) =>
        execMod.executeCadOperatorProduction({
            row: current,
            store,
            now: () => new Date(),
            materialize: async () => {
                if (handle.openTransactions() > 0) openDuringLoft = true;
                const started = Date.now();
                blockEventLoop(LOFT_BLOCK_MS);
                const side = current.side ?? "left";
                loftMs[side] = Date.now() - started;
                return {
                    stlStorageKey: FIXTURE_STL[side === "right" ? "right" : "left"],
                    meshFingerprint: "gate-fixture",
                };
            },
            slice: async (stlStorageKey: string) => ({
                gcode: FIXTURE_GCODE,
                jobId: `job-${stlStorageKey}`,
            }),
            uploadGcode: async (gcode: string) => {
                if (current.side === "left" || current.side === "right") uploaded.set(current.side, gcode);
                return { storageKey: `gcode/cad-operator/gate/${current.side}.gcode` };
            },
            charge: async () => ({ exportId: `exp-${current.side}`, balance: 1, alreadyCharged: false }),
        });

    const settled = await Promise.allSettled([run(left), run(right)]);
    for (const item of settled) {
        if (item.status === "rejected") {
            thrown.push(item.reason instanceof Error ? item.reason.message : String(item.reason));
        }
    }

    const leftRow = await store.findById(IDS.left);
    const rightRow = await store.findById(IDS.right);
    const errors = [leftRow?.error ?? "", rightRow?.error ?? "", ...thrown];
    const timedOut = errors.filter((error) => /Manufacturing timed out \((left|right)\)/.test(error));
    const closed = errors.filter((error) => /Transaction already closed/.test(error));
    const gcodeMatch = uploaded.get("left") === FIXTURE_GCODE && uploaded.get("right") === FIXTURE_GCODE;
    const stlMatch =
        leftRow?.gcodeStorageKey?.endsWith("left.gcode") === true &&
        rightRow?.gcodeStorageKey?.endsWith("right.gcode") === true;
    const loftLongEnough =
        (loftMs.left ?? 0) >= INTERACTIVE_TIMEOUT_MS && (loftMs.right ?? 0) >= INTERACTIVE_TIMEOUT_MS;
    const pass =
        leftRow?.status === "succeeded" &&
        rightRow?.status === "succeeded" &&
        timedOut.length === 0 &&
        closed.length === 0 &&
        openDuringLoft === false &&
        handle.maxElapsedMs() <= INTERACTIVE_TIMEOUT_MS &&
        gcodeMatch &&
        loftLongEnough &&
        thrown.length === 0;

    const measured = {
        left_status: leftRow?.status ?? null,
        right_status: rightRow?.status ?? null,
        left_error: leftRow?.error ?? null,
        right_error: rightRow?.error ?? null,
        thrown,
        manufacturing_timed_out: timedOut,
        transaction_already_closed: closed,
        open_during_loft: openDuringLoft,
        interactive_transactions: handle.transactions(),
        max_interactive_elapsed_ms: handle.maxElapsedMs(),
        interactive_timeout_ms: INTERACTIVE_TIMEOUT_MS,
        loft_block_ms: LOFT_BLOCK_MS,
        loft_ms: loftMs,
        fixture_gcode_bytes: Buffer.byteLength(FIXTURE_GCODE),
        uploaded_gcode_match: gcodeMatch,
        storage_keys: { left: leftRow?.gcodeStorageKey ?? null, right: rightRow?.gcodeStorageKey ?? null },
        storage_keys_match: stlMatch,
        sliced_stl_keys: FIXTURE_STL,
    };
    const result = {
        pass,
        summary: pass
            ? `both feet succeeded; loft ${loftMs.left}/${loftMs.right} ms; interactive elapsed ${handle.maxElapsedMs()} ms (threshold ${INTERACTIVE_TIMEOUT_MS} ms); open_during_loft=false`
            : `pair failed: left=${leftRow?.status ?? "missing"} right=${rightRow?.status ?? "missing"} open_during_loft=${openDuringLoft} max_interactive_elapsed_ms=${handle.maxElapsedMs()} timed_out=${timedOut.length} closed=${closed.length}`,
        measured,
    };
    finish(result);
    return pass ? 0 : 1;
}

main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        finish({
            pass: false,
            summary: message.split("\n")[0] ?? "gate A crashed",
            measured: { crash: message },
        });
        process.exit(1);
    });
