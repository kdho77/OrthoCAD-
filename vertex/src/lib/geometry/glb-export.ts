import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import * as THREE from "three";

export interface GlbExportResult {
    arrayBuffer: ArrayBuffer;
    base64: string;
}

/** Export a Three.js object (mesh or group) to binary GLB. */
export function exportObjectToGlb(object: THREE.Object3D): Promise<GlbExportResult> {
    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
        exporter.parse(
            object,
            (result) => {
                const arrayBuffer = result as ArrayBuffer;
                const bytes = new Uint8Array(arrayBuffer);
                let binary = "";
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]!);
                }
                resolve({ arrayBuffer, base64: btoa(binary) });
            },
            (err) => reject(err instanceof Error ? err : new Error(String(err))),
            { binary: true },
        );
    });
}

/** Build a standalone mesh object suitable for GLB export from buffer geometry. */
export function meshFromGeometry(geometry: THREE.BufferGeometry, color = "#a855f7"): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.8 });
    return new THREE.Mesh(geometry.clone(), mat);
}
