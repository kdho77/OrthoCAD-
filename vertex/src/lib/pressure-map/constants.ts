// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/** Longest edge after import downscale (pixels). */
export const PRESSURE_MAP_MAX_EDGE_PX = 1024;

/** Max stored data-URL payload (~750 KB character count). */
export const PRESSURE_MAP_MAX_DATA_URL_CHARS = 750_000;

/** Initial JPEG quality for persisted pressure maps. */
export const PRESSURE_MAP_JPEG_QUALITY = 0.82;

/** Minimum JPEG quality when iteratively shrinking to fit the cap. */
export const PRESSURE_MAP_JPEG_QUALITY_MIN = 0.45;
