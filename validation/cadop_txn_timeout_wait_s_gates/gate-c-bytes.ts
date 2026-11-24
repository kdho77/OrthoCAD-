// Gate C. STL and G-code bytes for a fixed fixture match the recorded BASE,
// and the 0.5× inset cap (SKEW_INSET_RATIO) stays 0.5.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BASE_SHA = "8aced4b5042bdafc2d300006fa80802bca1b94b9";
const MANIFEST = new URL("./base-byte-manifest.json", import.meta.url);
const COUPON = "python-service/tests/fixtures/a1_coupon_40x40x6.stl";
const SKEW_FILES = [
    "vertex/src/lib/geometry/procedural-wall/station-gates.ts",
    "vertex/src/lib/geometry/procedural-wall/stations.ts",
];
const SOURCE_PREFIXES = ["vertex/src/lib/geometry/", "vertex/src/lib/kiri/", "vertex/src/lib/cnc/"];

function productRoot(): string {
    return resolve(process.env.ORTHOCAD_ROOT ?? new URL("../../", import.meta.url).pathname);
}

function sha256(bytes: Buffer | string): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function finish(result: { pass: boolean; summary: string; measured: unknown }): void {
    const path = process.env.GATE_RESULT_PATH;
    if (path) writeFileSync(path, JSON.stringify(result, null, 2));
    console.log(result.summary);
}

function trackedSources(root: string): string[] {
    const listed = execFileSync(
        "git",
        ["ls-files", "-z", "--", ...SOURCE_PREFIXES.map((prefix) => prefix.slice(0, -1)), COUPON],
        {
            cwd: root,
            encoding: "utf8",
        },
    );
    return listed
        .split("\0")
        .filter((path) => path.length > 0)
        .filter((path) => !path.endsWith(".test.ts") && !path.includes(".test."))
        .sort();
}

function skewRatio(root: string, path: string): string | null {
    const text = readFileSync(resolve(root, path), "utf8");
    const match = text.match(/export const SKEW_INSET_RATIO = ([0-9.]+);/);
    return match?.[1] ?? null;
}

async function fixtureBytes(root: string): Promise<{ stl: Buffer; gcode: string }> {
    const three = await import("three");
    const stlUrl = pathToFileURL(resolve(root, "vertex/src/lib/geometry/stl.ts")).href;
    const engineUrl = pathToFileURL(resolve(root, "vertex/src/lib/kiri/engine.ts")).href;
    const stlMod = await import(stlUrl);
    const engine = await import(engineUrl);
    const geometry = new three.BufferGeometry();
    geometry.setAttribute(
        "position",
        new three.Float32BufferAttribute(
            [
                0, 0, 0, 20, 0, 0, 0, 12, 4, 20, 0, 0, 20, 12, 4, 0, 12, 4, 0, 0, 0, 0, 12, 4, 20, 0, 0, 20,
                0, 0, 20, 12, 4, 0, 12, 4,
            ],
            3,
        ),
    );
    const stl = Buffer.from(stlMod.geometryToBinarySTL(geometry));
    const gcode = engine.generateGcode(geometry, {
        id: "gate-desktop",
        name: "Gate fixture",
        method: "printing_solid",
        nozzleMm: 0.4,
        layerHeightMm: 0.2,
        material: "Apex Core",
        bed: { x: 250, y: 210, z: 210 },
    }).gcode;
    return { stl, gcode };
}

interface Manifest {
    base_sha: string;
    fixture: {
        stl_sha256: string;
        stl_bytes: number;
        gcode_sha256: string;
        gcode_bytes: number;
        coupon_stl: string;
        coupon_stl_sha256: string;
        coupon_stl_bytes: number;
    };
    skew_inset_ratio: string;
    files: Record<string, string>;
}

async function collect(root: string): Promise<Manifest> {
    const fixture = await fixtureBytes(root);
    const coupon = readFileSync(resolve(root, COUPON));
    const files: Record<string, string> = {};
    for (const path of trackedSources(root)) {
        files[path] = sha256(readFileSync(resolve(root, path)));
    }
    return {
        base_sha: BASE_SHA,
        fixture: {
            stl_sha256: sha256(fixture.stl),
            stl_bytes: fixture.stl.byteLength,
            gcode_sha256: sha256(fixture.gcode),
            gcode_bytes: Buffer.byteLength(fixture.gcode),
            coupon_stl: COUPON,
            coupon_stl_sha256: sha256(coupon),
            coupon_stl_bytes: coupon.byteLength,
        },
        skew_inset_ratio: "0.5",
        files,
    };
}

async function main(): Promise<number> {
    const root = productRoot();
    if (process.argv.includes("--record")) {
        if (process.env.GATE_RECORD_OVERWRITE !== "1") {
            try {
                readFileSync(MANIFEST);
                finish({
                    pass: false,
                    summary: "manifest already exists; refusing to overwrite the frozen BASE record",
                    measured: { manifest: MANIFEST.pathname },
                });
                return 1;
            } catch {
                // First record, before the freeze commit.
            }
        }
        const recorded = await collect(root);
        writeFileSync(MANIFEST, `${JSON.stringify(recorded, null, 2)}\n`);
        finish({
            pass: true,
            summary: `recorded ${Object.keys(recorded.files).length} files; stl ${recorded.fixture.stl_sha256.slice(0, 12)} gcode ${recorded.fixture.gcode_sha256.slice(0, 12)}`,
            measured: recorded.fixture,
        });
        return 0;
    }

    const expected = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
    const actual = await collect(root);
    const problems: string[] = [];
    if (actual.fixture.stl_sha256 !== expected.fixture.stl_sha256) {
        problems.push(
            `fixture STL sha256 ${actual.fixture.stl_sha256} != recorded ${expected.fixture.stl_sha256} (${actual.fixture.stl_bytes} bytes vs ${expected.fixture.stl_bytes})`,
        );
    }
    if (actual.fixture.gcode_sha256 !== expected.fixture.gcode_sha256) {
        problems.push(
            `fixture G-code sha256 ${actual.fixture.gcode_sha256} != recorded ${expected.fixture.gcode_sha256} (${actual.fixture.gcode_bytes} bytes vs ${expected.fixture.gcode_bytes})`,
        );
    }
    if (actual.fixture.coupon_stl_sha256 !== expected.fixture.coupon_stl_sha256) {
        problems.push(
            `coupon STL sha256 ${actual.fixture.coupon_stl_sha256} != recorded ${expected.fixture.coupon_stl_sha256}`,
        );
    }
    for (const path of SKEW_FILES) {
        const ratio = skewRatio(root, path);
        if (ratio !== "0.5") problems.push(`${path} SKEW_INSET_RATIO is ${String(ratio)} (threshold 0.5)`);
    }
    const expectedPaths = Object.keys(expected.files).sort();
    const actualPaths = Object.keys(actual.files).sort();
    const missing = expectedPaths.filter((path) => !(path in actual.files));
    const added = actualPaths.filter((path) => !(path in expected.files));
    const changed = expectedPaths.filter(
        (path) => actual.files[path] && actual.files[path] !== expected.files[path],
    );
    if (missing.length) problems.push(`missing source files: ${missing.slice(0, 8).join(", ")}`);
    if (added.length) problems.push(`new source files: ${added.slice(0, 8).join(", ")}`);
    if (changed.length) problems.push(`changed source files: ${changed.slice(0, 8).join(", ")}`);

    const pass = problems.length === 0;
    finish({
        pass,
        summary: pass
            ? `STL ${actual.fixture.stl_bytes} bytes and G-code ${actual.fixture.gcode_bytes} bytes match BASE ${BASE_SHA.slice(0, 12)}; SKEW_INSET_RATIO=0.5; ${actualPaths.length} source files unchanged`
            : (problems[0] ?? "byte gate failed"),
        measured: {
            base_sha: BASE_SHA,
            problems,
            fixture_stl_sha256: actual.fixture.stl_sha256,
            fixture_stl_bytes: actual.fixture.stl_bytes,
            fixture_gcode_sha256: actual.fixture.gcode_sha256,
            fixture_gcode_bytes: actual.fixture.gcode_bytes,
            coupon_stl_sha256: actual.fixture.coupon_stl_sha256,
            coupon_stl_bytes: actual.fixture.coupon_stl_bytes,
            skew_inset_ratio: SKEW_FILES.map((path) => ({ path, ratio: skewRatio(root, path) })),
            source_files: actualPaths.length,
            changed_source_files: changed,
            missing_source_files: missing,
            added_source_files: added,
        },
    });
    return pass ? 0 : 1;
}

main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        finish({
            pass: false,
            summary: message.split("\n")[0] ?? "gate C crashed",
            measured: { crash: message },
        });
        process.exit(1);
    });
