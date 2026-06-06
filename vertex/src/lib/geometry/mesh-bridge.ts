import type { IShape } from "@chili3d/core";
import { BufferAttribute, BufferGeometry } from "three";

/** Tessellates an OCCT solid into a Three.js BufferGeometry for the R3F viewer. */
export function shapeToBufferGeometry(shape: IShape): BufferGeometry {
    const faces = shape.mesh.faces;
    if (!faces || faces.position.length === 0 || faces.index.length === 0) {
        throw new Error("OCCT shape has no tessellated face mesh");
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(faces.position), 3));
    geometry.setIndex(Array.from(faces.index));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}
