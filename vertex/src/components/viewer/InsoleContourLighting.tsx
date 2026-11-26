// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/** Lower ambient + stronger key so Print/Export solid contours read clearly. */
export const PRINT_EXPORT_AMBIENT_INTENSITY = 0.32;
export const PRINT_EXPORT_KEY_INTENSITY = 1.38;
export const PRINT_EXPORT_FILL_INTENSITY = 0.22;
export const PRINT_EXPORT_RIM_INTENSITY = 0.16;

export function InsoleContourLighting() {
    return (
        <>
            <ambientLight intensity={PRINT_EXPORT_AMBIENT_INTENSITY} />
            <directionalLight position={[150, 300, 200]} intensity={PRINT_EXPORT_KEY_INTENSITY} castShadow />
            <directionalLight position={[-150, 100, -100]} intensity={PRINT_EXPORT_FILL_INTENSITY} />
            <directionalLight position={[40, 80, -200]} intensity={PRINT_EXPORT_RIM_INTENSITY} />
        </>
    );
}

export function InsoleStandardLighting() {
    return (
        <>
            <ambientLight intensity={0.6} />
            <directionalLight position={[150, 300, 200]} intensity={1.1} castShadow />
            <directionalLight position={[-150, 100, -100]} intensity={0.4} />
        </>
    );
}