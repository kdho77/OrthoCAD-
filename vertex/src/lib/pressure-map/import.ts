// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PressureMapFoot } from "@/types";
import { detectContentBoundsFromImageData } from "./content-bounds";
import { DEFAULT_PRESSURE_MAP_ALIGNMENT, normalizePressureMapMime } from "./types";

export async function loadPressureMapFromFile(file: File): Promise<PressureMapFoot> {
    const mime = normalizePressureMapMime(file.type || "image/png");
    const dataUrl = await readFileAsDataUrl(file);
    const { width, height, imageData } = await decodeDataUrl(dataUrl);
    const contentBounds = detectContentBoundsFromImageData(imageData);
    return {
        imageDataUrl: dataUrl,
        mimeType: mime,
        fileName: file.name,
        visible: true,
        imageWidth: width,
        imageHeight: height,
        contentBounds,
        alignment: { ...DEFAULT_PRESSURE_MAP_ALIGNMENT },
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
