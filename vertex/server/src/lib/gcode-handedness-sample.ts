// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Tiny belt extrusion cloud that satisfies hand_classify.py for unit tests.
// Not a slicer output and not used in production.

/** A physical left or right foot under the frozen belt rules (heel at high zt, arch on that side). */
export function passingBeltGcode(foot: "left" | "right"): string {
    const lines: string[] = ["M83"];
    for (let i = 0; i < 1100; i++) {
        const x = i % 2 === 0 ? -30 : 30;
        const z = (i / 1099) * 200;
        lines.push(`G1 X${x.toFixed(3)} Y0.200 Z${z.toFixed(3)} E0.010`);
    }
    lines.push("G1 X0.000 Y12.000 Z191.800 E0.050");
    const archX = foot === "left" ? 30 : -30;
    lines.push(`G1 X${archX.toFixed(3)} Y10.000 Z109.800 E0.050`);
    return `${lines.join("\n")}\n`;
}
