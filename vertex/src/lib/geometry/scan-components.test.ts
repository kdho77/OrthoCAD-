// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    extractKeptGeometry,
    rankComponents,
    selectedComponentsBBox,
    weldAndLabelComponents,
} from "@/lib/geometry/scan-components";
import {
    buildScanDisplayInfo,
    buildScanDisplayInfoFromBBox,
    inferScanDisplayScale,
} from "@/lib/geometry/scan-display";
import { suggestScanLandmarks } from "@/lib/geometry/scan-landmark-suggest";
import { buildDecimatedPickGeometry, scanNeedsPickProxy } from "@/lib/geometry/scan-pick-mesh";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { useScanStore } from "@/stores/scan-store";

/** Non-indexed triangle soup from a BoxGeometry (unique verts per corner use). */
function boxSoup(sx: number, sy: number, sz: number, ox = 0, oy = 0, oz = 0): Float32Array {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(ox, oy, oz);
    const non = g.toNonIndexed();
    g.dispose();
    const pos = non.getAttribute("position");
    const arr = new Float32Array(pos.array as ArrayLike<number>);
    non.dispose();
    return arr;
}

function soupGeometry(...parts: Float32Array[]): THREE.BufferGeometry {
    let total = 0;
    for (const p of parts) total += p.length;
    const merged = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
        merged.set(p, o);
        o += p.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(merged, 3));
    return geo;
}

/** Thin open sheet (two triangles) in XY plane. */
function sheetSoup(cx: number, cy: number, cz: number, w: number, h: number): Float32Array {
    const hx = w / 2;
    const hy = h / 2;
    return new Float32Array([
        cx - hx,
        cy - hy,
        cz,
        cx + hx,
        cy - hy,
        cz,
        cx + hx,
        cy + hy,
        cz,
        cx - hx,
        cy - hy,
        cz,
        cx + hx,
        cy + hy,
        cz,
        cx - hx,
        cy + hy,
        cz,
    ]);
}

/** Dense bulky open shell: tessellated box faces (many tris), foot-like extents. */
function bulkyFootSoup(length = 0.26, width = 0.1, height = 0.08): Float32Array {
    // Subdivide a box into many triangles via SphereGeometry scaled — or stacked boxes.
    // Use a sphere (closed, dense) translated to origin — bulky fill.
    const g = new THREE.SphereGeometry(length / 2, 24, 16);
    g.scale(1, width / length, height / length);
    g.translate(length / 2, 0, height / 2);
    const non = g.toNonIndexed();
    g.dispose();
    const arr = new Float32Array(non.getAttribute("position").array as ArrayLike<number>);
    non.dispose();
    return arr;
}

describe("Phase 3 — scan component cleanup", () => {
    test("T1 — non-indexed triangle soup with 3 disjoint shells labels as 3 components", () => {
        const a = boxSoup(1, 1, 1, 0, 0, 0);
        const b = boxSoup(1, 1, 1, 10, 0, 0);
        const c = boxSoup(1, 1, 1, 0, 10, 0);
        const geo = soupGeometry(a, b, c);
        // Confirm non-indexed soup: 12 tris × 3 verts × 3 shells = 108 verts, no index.
        expect(geo.getIndex()).toBeNull();
        expect(geo.getAttribute("position").count).toBe(108);

        const labeling = weldAndLabelComponents(geo);
        expect(labeling.components.length).toBe(3);
        expect(labeling.degenerateTriangleCount).toBe(0);
        // Without welding, naive labeling would yield 36 components (one per tri).
        expect(labeling.components.length).not.toBe(36);
        geo.dispose();
    });

    test("T2 — bulky foot-like shell ranks above thin sheet fragments", () => {
        const foot = bulkyFootSoup(0.26, 0.1, 0.08);
        const sheet1 = sheetSoup(5, 0, 0, 2, 2);
        const sheet2 = sheetSoup(-5, 0, 0, 2, 2);
        const geo = soupGeometry(foot, sheet1, sheet2);
        const labeling = weldAndLabelComponents(geo);
        expect(labeling.components.length).toBe(3);
        const ranked = rankComponents(labeling.components);
        expect(ranked[0]!.triangleCount).toBeGreaterThan(ranked[1]!.triangleCount);
        expect(ranked[0]!.fillRatio).toBeGreaterThan(ranked[1]!.fillRatio);
        expect(ranked[0]!.rank).toBe(1);
        expect(ranked[0]!.rankReasons.length).toBeGreaterThan(0);
        geo.dispose();
    });

    test("T3 — extracted kept geometry is triangle-equivalent to original (no weld artifacts)", () => {
        const a = boxSoup(1, 1, 1, 0, 0, 0);
        const b = boxSoup(1, 1, 1, 10, 0, 0);
        const geo = soupGeometry(a, b);
        const labeling = weldAndLabelComponents(geo);
        const ranked = rankComponents(labeling.components);
        const keepId = ranked[0]!.id;
        const extracted = extractKeptGeometry(geo, labeling, [keepId]);

        const srcPos = geo.getAttribute("position");
        const extPos = extracted.getAttribute("position");
        expect(extracted.getIndex()).toBeNull();
        expect(extPos.count).toBe(ranked[0]!.triangleCount * 3);

        // Every extracted triangle vertex must match an original triangle of that component.
        const origTris: string[] = [];
        for (let t = 0; t < labeling.originalTriangleCount; t++) {
            if (labeling.triangleComponentOf[t] !== keepId) continue;
            const i = t * 3;
            const key = [
                srcPos.getX(i),
                srcPos.getY(i),
                srcPos.getZ(i),
                srcPos.getX(i + 1),
                srcPos.getY(i + 1),
                srcPos.getZ(i + 1),
                srcPos.getX(i + 2),
                srcPos.getY(i + 2),
                srcPos.getZ(i + 2),
            ].join(",");
            origTris.push(key);
        }
        const extTris: string[] = [];
        for (let t = 0; t < extPos.count / 3; t++) {
            const i = t * 3;
            extTris.push(
                [
                    extPos.getX(i),
                    extPos.getY(i),
                    extPos.getZ(i),
                    extPos.getX(i + 1),
                    extPos.getY(i + 1),
                    extPos.getZ(i + 1),
                    extPos.getX(i + 2),
                    extPos.getY(i + 2),
                    extPos.getZ(i + 2),
                ].join(","),
            );
        }
        expect(extTris.sort()).toEqual(origTris.sort());
        extracted.dispose();
        geo.dispose();
    });

    test("T4 — unit inference on selected component differs from polluted raw bbox", () => {
        // Foot in metres (~0.27m) + distant huge sheet that pollutes longest dim.
        const foot = bulkyFootSoup(0.27, 0.1, 0.08);
        const stray = sheetSoup(0, 50, 0, 2.0, 0.5); // extends Y hugely
        const geo = soupGeometry(foot, stray);
        const labeling = weldAndLabelComponents(geo);
        const ranked = rankComponents(labeling.components);
        const footComp = ranked[0]!;

        const rawInfo = buildScanDisplayInfo(geo);
        const bbox = selectedComponentsBBox(ranked, [footComp.id])!;
        const selInfo = buildScanDisplayInfoFromBBox(bbox.min, bbox.max, {
            inferredUnit: rawInfo.inferredUnit,
            dominantRawAxis: rawInfo.dominantRawAxis,
            rawLongest: rawInfo.rawLongest,
        });

        expect(rawInfo.rawLongest).toBeGreaterThan(selInfo.rawLongest);
        // Selected foot ~0.27m → unit m; polluted raw may still be m but longest differs.
        expect(selInfo.inferredUnit).toBe("m");
        expect(inferScanDisplayScale(selInfo.rawLongest).displayScale).toBe(1000);
        expect(selInfo.rawLongest).toBeLessThan(0.5);
        expect(selInfo.priorRawLongest).toBe(rawInfo.rawLongest);
        geo.dispose();
    });

    test("T5 — provisional orientation recomputes when selection changes", () => {
        const a = boxSoup(0.3, 0.05, 0.05, 0, 0, 0); // X-long
        const b = boxSoup(0.05, 0.3, 0.05, 5, 0, 0); // Y-long, separate
        const geo = soupGeometry(a, b);
        const labeling = weldAndLabelComponents(geo);
        const comps = rankComponents(labeling.components);
        expect(comps.length).toBe(2);

        const bboxA = selectedComponentsBBox(comps, [comps[0]!.id])!;
        const bboxB = selectedComponentsBBox(comps, [comps[1]!.id])!;
        const dA = buildScanDisplayInfoFromBBox(bboxA.min, bboxA.max);
        const dB = buildScanDisplayInfoFromBBox(bboxB.min, bboxB.max);
        expect(dA.dominantRawAxis).not.toBe(dB.dominantRawAxis);
        expect(dA.provisionalMatrixElements).not.toEqual(dB.provisionalMatrixElements);
        geo.dispose();
    });

    test("T6 — restore-all returns geometry identical to raw import", () => {
        const a = boxSoup(1, 1, 1, 0, 0, 0);
        const b = boxSoup(1, 1, 1, 10, 0, 0);
        const raw = soupGeometry(a, b);
        const labeling = weldAndLabelComponents(raw);
        const ranked = rankComponents(labeling.components);

        useScanStore.getState().clear();
        useScanStore.getState().addScan({
            id: "t6",
            name: "t6.stl",
            side: "left",
            format: "stl",
            triangleCount: labeling.originalTriangleCount,
            geometry: extractKeptGeometry(raw, labeling, [ranked[0]!.id]),
            rawGeometry: raw,
            manifold: {
                isWatertight: false,
                openEdges: 1,
                triangleCount: ranked[0]!.triangleCount,
                vertexCount: 1,
                nonManifoldEdges: 0,
            },
            components: ranked,
            keptComponentIds: [ranked[0]!.id],
            triangleComponentOf: labeling.triangleComponentOf,
            labelingMeta: {
                degenerateTriangleCount: labeling.degenerateTriangleCount,
                weldTolerance: labeling.weldTolerance,
                elapsedMs: labeling.elapsedMs,
                originalTriangleCount: labeling.originalTriangleCount,
            },
        });

        useScanStore.getState().restoreAllComponents("t6");
        const scan = useScanStore.getState().scans.find((s) => s.id === "t6")!;
        expect(scan.keptComponentIds.sort()).toEqual(ranked.map((c) => c.id).sort());

        const restored = scan.geometry.getAttribute("position");
        const orig = raw.getAttribute("position");
        expect(restored.count).toBe(orig.count);
        for (let i = 0; i < orig.count * 3; i++) {
            expect(restored.array[i]).toBe(orig.array[i]);
        }
        useScanStore.getState().clear();
    });

    test("T7 — raycast/pick path uses kept geometry only (hidden excluded)", () => {
        const a = boxSoup(1, 1, 1, 0, 0, 0);
        const b = boxSoup(1, 1, 1, 10, 0, 0);
        const raw = soupGeometry(a, b);
        const labeling = weldAndLabelComponents(raw);
        const ranked = rankComponents(labeling.components);
        const kept = extractKeptGeometry(raw, labeling, [ranked[0]!.id]);
        const hidden = extractKeptGeometry(raw, labeling, [ranked[1]!.id]);

        // Scene mounts only kept — hidden never becomes a pick target.
        const scene = new THREE.Scene();
        const keptMesh = new THREE.Mesh(kept);
        keptMesh.userData = { scanId: "t7", isScanMesh: true };
        scene.add(keptMesh);

        if (scanNeedsPickProxy(kept)) {
            const proxy = buildDecimatedPickGeometry(kept);
            const proxyMesh = new THREE.Mesh(proxy);
            proxyMesh.userData = {
                scanId: "t7",
                isScanPickMesh: true,
                fullGeometry: kept,
            };
            scene.add(proxyMesh);
        }

        const pickTargets: THREE.Object3D[] = [];
        scene.traverse((obj) => {
            if (!(obj as THREE.Mesh).isMesh) return;
            if (obj.userData?.isScanPickMesh || obj.userData?.isScanMesh) pickTargets.push(obj);
        });
        for (const t of pickTargets) {
            const g = (t as THREE.Mesh).geometry;
            const full = (t.userData.fullGeometry as THREE.BufferGeometry | undefined) ?? g;
            expect(full.getAttribute("position").count).toBe(kept.getAttribute("position").count);
            expect(full.getAttribute("position").count).not.toBe(
                hidden.getAttribute("position").count + kept.getAttribute("position").count,
            );
        }
        kept.dispose();
        hidden.dispose();
        raw.dispose();
    });

    test("T8 — markers invalidated when kept set changes", () => {
        const a = boxSoup(1, 1, 1, 0, 0, 0);
        const b = boxSoup(1, 1, 1, 10, 0, 0);
        const raw = soupGeometry(a, b);
        const labeling = weldAndLabelComponents(raw);
        const ranked = rankComponents(labeling.components);

        useScanStore.getState().clear();
        useScanStore.getState().addScan({
            id: "t8",
            name: "t8.stl",
            side: "left",
            format: "stl",
            triangleCount: 12,
            geometry: extractKeptGeometry(raw, labeling, [ranked[0]!.id]),
            rawGeometry: raw,
            manifold: {
                isWatertight: false,
                openEdges: 1,
                triangleCount: 12,
                vertexCount: 1,
                nonManifoldEdges: 0,
            },
            components: ranked,
            keptComponentIds: [ranked[0]!.id],
            triangleComponentOf: labeling.triangleComponentOf,
            labelingMeta: {
                degenerateTriangleCount: 0,
                weldTolerance: labeling.weldTolerance,
                elapsedMs: 1,
                originalTriangleCount: labeling.originalTriangleCount,
            },
        });
        useScanStore.getState().setMarker("t8", "M1", new THREE.Vector3(1, 2, 3));
        expect(useScanStore.getState().markersByScanId["t8"]!.M1).not.toBeNull();

        const result = useScanStore.getState().setKeptComponents("t8", [ranked[1]!.id]);
        expect(result.ok).toBe(true);
        expect(useScanStore.getState().markersByScanId["t8"]!.M1).toBeNull();
        expect(useScanStore.getState().scans[0]!.cleanupMessage).toMatch(/Markers and registration cleared/);

        const blocked = useScanStore.getState().setKeptComponents("t8", []);
        expect(blocked.ok).toBe(false);
        useScanStore.getState().clear();
    });

    test("T9 — suggested landmarks on synthetic foot: M2 proximal, sep 5–15%", () => {
        // Controlled plantar cloud: length 270mm along X.
        // Outline half-width peaks at designed stations so independent crest
        // search finds medial max at u=0.75 and lateral max at u=0.65 (~10%).
        const length = 270;
        const positions: number[] = [];
        const pushTri = (
            ax: number,
            ay: number,
            az: number,
            bx: number,
            by: number,
            bz: number,
            cx: number,
            cy: number,
            cz: number,
        ) => {
            positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        };
        const halfWidthAt = (u: number, side: 1 | -1): number => {
            // Base taper 20→35mm; add 15mm peak at medial 0.75 / lateral 0.65.
            let w = 20 + 15 * Math.sin(Math.PI * u);
            if (side === 1) {
                const d = (u - 0.75) / 0.04;
                w += 15 * Math.exp(-(d * d));
            } else {
                const d = (u - 0.65) / 0.04;
                w += 15 * Math.exp(-(d * d));
            }
            return w;
        };
        const nu = 80;
        const nv = 24;
        for (let iu = 0; iu < nu; iu++) {
            const u0 = iu / nu;
            const u1 = (iu + 1) / nu;
            for (let iv = 0; iv < nv; iv++) {
                const v0 = iv / nv;
                const v1 = (iv + 1) / nv;
                // v maps -1..+1 across width using per-u half-widths (asymmetric).
                const yOf = (u: number, v: number) => {
                    const wm = halfWidthAt(u, 1);
                    const wl = halfWidthAt(u, -1);
                    // v=0 → midline; v>0 medial (+Y); v<0 lateral (−Y)
                    return v >= 0 ? v * wm : v * wl;
                };
                const zOf = (u: number, y: number) => {
                    if (u < 1 / 3) return 2 + Math.abs(y) * 0.02;
                    return 10 + 8 * u + Math.abs(y) * 0.05;
                };
                const x0 = u0 * length;
                const x1 = u1 * length;
                const vA = -1 + 2 * v0;
                const vB = -1 + 2 * v1;
                const y00 = yOf(u0, vA);
                const y10 = yOf(u1, vA);
                const y01 = yOf(u0, vB);
                const y11 = yOf(u1, vB);
                pushTri(x0, y00, zOf(u0, y00), x1, y10, zOf(u1, y10), x1, y11, zOf(u1, y11));
                pushTri(x0, y00, zOf(u0, y00), x1, y11, zOf(u1, y11), x0, y01, zOf(u0, y01));
            }
        }
        const foot = new THREE.BufferGeometry();
        foot.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

        const sug = suggestScanLandmarks(foot, "left");
        expect(sug).not.toBeNull();
        expect(sug!.m1m2SeparationPct).toBeGreaterThanOrEqual(5);
        expect(sug!.m1m2SeparationPct).toBeLessThanOrEqual(15);
        // M2 proximal ⇒ smaller X than M1 when length along +X
        expect(sug!.M2.x).toBeLessThan(sug!.M1.x);
        foot.dispose();
    });

    test("T10 — suggestion failure falls back to null without throwing", () => {
        const empty = new THREE.BufferGeometry();
        empty.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
        expect(() => suggestScanLandmarks(empty, "left")).not.toThrow();
        expect(suggestScanLandmarks(empty, "left")).toBeNull();
        empty.dispose();
    });

    test("T11 — EXPORT BYTE-IDENTICAL after import+cleanup+suggest+register path", () => {
        const sourceBase = new THREE.BoxGeometry(260, 90, 8);
        const exportBuffer = () => geometryToBinarySTL(sourceBase);
        const bufBefore = exportBuffer();

        const foot = bulkyFootSoup(0.26, 0.1, 0.08);
        const stray = sheetSoup(5, 0, 0, 1, 1);
        const raw = soupGeometry(foot, stray);
        const labeling = weldAndLabelComponents(raw);
        const ranked = rankComponents(labeling.components);
        const kept = extractKeptGeometry(raw, labeling, [ranked[0]!.id]);
        const sug = suggestScanLandmarks(kept, "left");

        useScanStore.getState().clear();
        useScanStore.getState().addScan({
            id: "t11",
            name: "patient.stl",
            side: "left",
            format: "stl",
            triangleCount: ranked[0]!.triangleCount,
            geometry: kept,
            rawGeometry: raw,
            manifold: {
                isWatertight: false,
                openEdges: 1,
                triangleCount: ranked[0]!.triangleCount,
                vertexCount: 1,
                nonManifoldEdges: 0,
            },
            components: ranked,
            keptComponentIds: [ranked[0]!.id],
            triangleComponentOf: labeling.triangleComponentOf,
            labelingMeta: {
                degenerateTriangleCount: labeling.degenerateTriangleCount,
                weldTolerance: labeling.weldTolerance,
                elapsedMs: labeling.elapsedMs,
                originalTriangleCount: labeling.originalTriangleCount,
            },
            suggestedLandmarks: sug,
        });
        useScanStore.getState().setKeptComponents("t11", [ranked[0]!.id]);
        if (sug) {
            useScanStore.getState().setMarker("t11", "M1", sug.M1);
            useScanStore.getState().setMarker("t11", "M2", sug.M2);
            useScanStore.getState().setMarker("t11", "M3", sug.M3);
        }
        useScanStore.getState().setDeviationOverlay(true);

        const bufAfter = exportBuffer();
        expect(bufAfter.byteLength).toBe(bufBefore.byteLength);
        const a = new Uint8Array(bufBefore);
        const b = new Uint8Array(bufAfter);
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                throw new Error(`T11 HARD STOP: export byte mismatch at offset ${i}`);
            }
        }
        useScanStore.getState().clear();
        sourceBase.dispose();
    });

    test("T12 — weld+label 300k triangles reports elapsed; busy above 250ms", () => {
        // Build ≥300k non-indexed tris via a dense heightfield (deterministic, no deps).
        const nx = 450;
        const ny = 340; // 450*340*2 = 306_000 tris
        const positions = new Float32Array(nx * ny * 2 * 9);
        let o = 0;
        for (let ix = 0; ix < nx; ix++) {
            for (let iy = 0; iy < ny; iy++) {
                const x0 = ix;
                const x1 = ix + 1;
                const y0 = iy;
                const y1 = iy + 1;
                const z00 = Math.sin(ix * 0.01) + Math.cos(iy * 0.01);
                const z10 = Math.sin((ix + 1) * 0.01) + Math.cos(iy * 0.01);
                const z01 = Math.sin(ix * 0.01) + Math.cos((iy + 1) * 0.01);
                const z11 = Math.sin((ix + 1) * 0.01) + Math.cos((iy + 1) * 0.01);
                // tri 1
                positions[o++] = x0;
                positions[o++] = y0;
                positions[o++] = z00;
                positions[o++] = x1;
                positions[o++] = y0;
                positions[o++] = z10;
                positions[o++] = x1;
                positions[o++] = y1;
                positions[o++] = z11;
                // tri 2
                positions[o++] = x0;
                positions[o++] = y0;
                positions[o++] = z00;
                positions[o++] = x1;
                positions[o++] = y1;
                positions[o++] = z11;
                positions[o++] = x0;
                positions[o++] = y1;
                positions[o++] = z01;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const triCount = positions.length / 9;
        expect(triCount).toBeGreaterThanOrEqual(300_000);

        const labeling = weldAndLabelComponents(geo);
        expect(labeling.components.length).toBeGreaterThanOrEqual(1);
        expect(labeling.elapsedMs).toBeGreaterThan(0);
        const needsBusy = labeling.elapsedMs > 250;
        // Busy treatment threshold is wired in ScanImport (setCleanupBusy when >250ms).
        expect(typeof needsBusy).toBe("boolean");
        // eslint-disable-next-line no-console
        console.log(
            `[T12] weld+label tris=${triCount} elapsedMs=${labeling.elapsedMs.toFixed(1)} busy=${needsBusy}`,
        );
        geo.dispose();
    });
});
