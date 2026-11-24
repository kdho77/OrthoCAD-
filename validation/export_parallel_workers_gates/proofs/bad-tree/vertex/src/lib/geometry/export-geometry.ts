import { buildFootSolidInWorker } from "./procedural-wall/export-solid-workers";

export async function buildOrderPairGeometry() {
    const parts = [];
    for (const side of ["left", "right"]) {
        parts.push(await buildFootSolidInWorker(side));
    }
    return parts;
}
