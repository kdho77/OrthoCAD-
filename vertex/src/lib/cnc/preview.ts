// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { parseGcode } from "./parse";
import type { MillingProfile } from "./types";

export interface PreviewRgb {
    width: number;
    height: number;
    rgb: Uint8Array;
}

function setPx(
    rgb: Uint8Array,
    w: number,
    h: number,
    x: number,
    y: number,
    c: [number, number, number],
): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const i = (py * w + px) * 3;
    rgb[i] = c[0];
    rgb[i + 1] = c[1];
    rgb[i + 2] = c[2];
}

function line(
    rgb: Uint8Array,
    w: number,
    h: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c: [number, number, number],
): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        setPx(rgb, w, h, x0 + dx * t, y0 + dy * t, c);
    }
}

/** Top-down toolpath preview of the milling table. */
export function renderToolpathPreview(
    gcode: string,
    profile: MillingProfile,
    width = 900,
    height = 640,
): PreviewRgb {
    const parsed = parseGcode(gcode, profile.freeMovementHeightMm);
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(18);
    const pad = 28;
    const sx = (width - 2 * pad) / profile.tableWidthMm;
    const sy = (height - 2 * pad) / profile.tableLengthMm;
    const s = Math.min(sx, sy);
    const ox = pad + (width - 2 * pad - s * profile.tableWidthMm) / 2;
    const oy = pad + (height - 2 * pad - s * profile.tableLengthMm) / 2;
    const toPx = (x: number, y: number): [number, number] => [ox + x * s, height - (oy + y * s)];

    line(rgb, width, height, ...toPx(0, 0), ...toPx(profile.tableWidthMm, 0), [60, 80, 110]);
    line(
        rgb,
        width,
        height,
        ...toPx(profile.tableWidthMm, 0),
        ...toPx(profile.tableWidthMm, profile.tableLengthMm),
        [60, 80, 110],
    );
    line(
        rgb,
        width,
        height,
        ...toPx(profile.tableWidthMm, profile.tableLengthMm),
        ...toPx(0, profile.tableLengthMm),
        [60, 80, 110],
    );
    line(rgb, width, height, ...toPx(0, profile.tableLengthMm), ...toPx(0, 0), [60, 80, 110]);
    for (const p of profile.pockets) {
        line(rgb, width, height, ...toPx(p.x, p.y), ...toPx(p.x + p.width, p.y), [90, 110, 140]);
        line(
            rgb,
            width,
            height,
            ...toPx(p.x + p.width, p.y),
            ...toPx(p.x + p.width, p.y + p.length),
            [90, 110, 140],
        );
        line(
            rgb,
            width,
            height,
            ...toPx(p.x + p.width, p.y + p.length),
            ...toPx(p.x, p.y + p.length),
            [90, 110, 140],
        );
        line(rgb, width, height, ...toPx(p.x, p.y + p.length), ...toPx(p.x, p.y), [90, 110, 140]);
    }

    const skin = Math.abs(profile.extraMovementMm);
    for (const m of parsed.moves) {
        if (m.motion !== "G1") continue;
        const z = Math.min(m.z, m.from.z);
        const c: [number, number, number] = z <= skin + 0.5 ? [255, 80, 180] : [40, 220, 230];
        line(rgb, width, height, ...toPx(m.from.x, m.from.y), ...toPx(m.x, m.y), c);
    }
    return { width, height, rgb };
}
