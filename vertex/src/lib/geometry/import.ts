import type { BufferGeometry } from "three";
import { mergeVertices } from "three-stdlib";
import { OBJLoader, STLLoader } from "three-stdlib";

// Client-side import of STL (binary/ASCII) and OBJ scans/prefabs into a single
// BufferGeometry, ready for the viewer and the geometry kernel.

export type ImportFormat = "stl" | "obj";

export interface ImportResult {
    geometry: BufferGeometry;
    format: ImportFormat;
    triangleCount: number;
}

function detectFormat(fileName: string): ImportFormat {
    const ext = fileName.toLowerCase().split(".").pop();
    if (ext === "obj") return "obj";
    if (ext === "stl") return "stl";
    throw new Error(`Unsupported file type: .${ext ?? "?"} (use .stl or .obj)`);
}

export async function importScanFile(file: File): Promise<ImportResult> {
    const format = detectFormat(file.name);

    let geometry: BufferGeometry;
    if (format === "stl") {
        const buffer = await file.arrayBuffer();
        geometry = new STLLoader().parse(buffer);
    } else {
        const text = await file.text();
        const group = new OBJLoader().parse(text);
        const meshes: BufferGeometry[] = [];
        group.traverse((child) => {
            const g = (child as { geometry?: BufferGeometry }).geometry;
            if (g?.isBufferGeometry) meshes.push(g);
        });
        if (meshes.length === 0) throw new Error("OBJ contains no mesh geometry");
        geometry = meshes[0];
    }

    // Weld coincident vertices so manifold analysis and downstream booleans work.
    geometry.deleteAttribute("uv");
    geometry.deleteAttribute("normal");
    geometry = mergeVertices(geometry);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : geometry.getAttribute("position").count / 3;

    return { geometry, format, triangleCount };
}
