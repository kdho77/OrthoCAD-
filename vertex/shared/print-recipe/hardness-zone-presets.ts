// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Preset sole-UV rectangles for progressive zone authoring (Phase B). */
export const HARDNESS_ZONE_PRESETS = [
    {
        id: "heel",
        label: "Heel block",
        anatomicLabel: "Heel",
        boundarySoleUv: [
            { u: 0, v: -1 },
            { u: 0.35, v: -1 },
            { u: 0.35, v: 1 },
            { u: 0, v: 1 },
        ],
    },
    {
        id: "forefoot",
        label: "Forefoot block",
        anatomicLabel: "Forefoot",
        boundarySoleUv: [
            { u: 0.65, v: -1 },
            { u: 1, v: -1 },
            { u: 1, v: 1 },
            { u: 0.65, v: 1 },
        ],
    },
    {
        id: "medial",
        label: "Medial strip",
        anatomicLabel: "Medial",
        boundarySoleUv: [
            { u: 0, v: 0.25 },
            { u: 1, v: 0.25 },
            { u: 1, v: 1 },
            { u: 0, v: 1 },
        ],
    },
    {
        id: "lateral",
        label: "Lateral strip",
        anatomicLabel: "Lateral",
        boundarySoleUv: [
            { u: 0, v: -1 },
            { u: 1, v: -1 },
            { u: 1, v: -0.25 },
            { u: 0, v: -0.25 },
        ],
    },
] as const;

export const HARDNESS_OVERLAY_HEX: Record<string, string> = {
    "Extra Soft": "#9333ea",
    Soft: "#3b82f6",
    Medium: "#22c55e",
    Hard: "#eab308",
    "Extra Hard": "#ef4444",
};

export const HARDNESS_OVERLAY_COLORS: Record<string, string> = {
    "Extra Soft": "rgba(147, 51, 234, 0.45)",
    Soft: "rgba(59, 130, 246, 0.45)",
    Medium: "rgba(34, 197, 94, 0.35)",
    Hard: "rgba(234, 179, 8, 0.45)",
    "Extra Hard": "rgba(239, 68, 68, 0.45)",
};
