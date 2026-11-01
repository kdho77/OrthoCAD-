// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PressureMapFoot, Side } from "@/types";
import {
    PRESSURE_MAP_JPEG_QUALITY,
    PRESSURE_MAP_JPEG_QUALITY_MIN,
    PRESSURE_MAP_MAX_DATA_URL_CHARS,
    PRESSURE_MAP_MAX_EDGE_PX,
} from "./constants";
import { detectContentBoundsFromImageData } from "./content-bounds";
import { analyzePressureImageOrientation } from "./orientation";
import { DEFAULT_PRESSURE_MAP_ALIGNMENT, normalizePressureMapMime } from "./types";

/**
 * Import pipeline: decode → downscale (max {@link PRESSURE_MAP_MAX_EDGE_PX}px) →
 * JPEG re-encode capped at {@link PRESSURE_MAP_MAX_DATA_URL_CHARS} chars → detect bounds/orientation.
 */
export async function loadPressureMapFromFile(file: File, assignToSide: Side): Promise<PressureMapFoot> {
    normalizePressureMapMime(file.type || "image/png");
    const rawUrl = await readFileAsDataUrl(file);
    const decoded = await decodeDataUrl(rawUrl);
    const packed = downscaleAndEncode(decoded.imageData, decoded.width, decoded.height);
    const contentBounds = detectContentBoundsFromImageData(packed.imageData);
    const orientation = analyzePressureImageOrientation(
        packed.imageData.data,
        packed.width,
        packed.height,
        contentBounds,
        assignToSide,
    );
    return {
        imageDataUrl: packed.dataUrl,
        mimeType: "image/jpeg",
        fileName: file.name,
        visible: true,
        imageWidth: packed.width,
        imageHeight: packed.height,
        contentBounds,
        alignment: { ...DEFAULT_PRESSURE_MAP_ALIGNMENT },
        orientation,
    };
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
        reader.readAsDataURL(file);
    });
}

async function decodeDataUrl(dataUrl: string): Promise<{
    width: number;
    height: number;
    imageData: ImageData;
}> {
    if (typeof document === "undefined") {
        throw new Error("decodeDataUrl requires a DOM document");
    }
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Invalid pressure map image"));
        img.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, imageData };
}

function downscaleAndEncode(
    source: ImageData,
    srcW: number,
    srcH: number,
): { width: number; height: number; imageData: ImageData; dataUrl: string } {
    if (typeof document === "undefined") throw new Error("Canvas unavailable");
    const scale = Math.min(1, PRESSURE_MAP_MAX_EDGE_PX / Math.max(srcW, srcH));
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    const tmp = document.createElement("canvas");
    tmp.width = srcW;
    tmp.height = srcH;
    tmp.getContext("2d")!.putImageData(source, 0, 0);
    ctx.drawImage(tmp, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    let quality = PRESSURE_MAP_JPEG_QUALITY;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > PRESSURE_MAP_MAX_DATA_URL_CHARS && quality > PRESSURE_MAP_JPEG_QUALITY_MIN) {
        quality = Math.max(PRESSURE_MAP_JPEG_QUALITY_MIN, quality - 0.08);
        dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > PRESSURE_MAP_MAX_DATA_URL_CHARS) {
        throw new Error(
            `Pressure map still exceeds ${PRESSURE_MAP_MAX_DATA_URL_CHARS} characters after downscale — use a smaller image`,
        );
    }
    return { width, height, imageData, dataUrl };
}
