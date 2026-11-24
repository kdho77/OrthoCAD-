import { buildFootSolidInWorker } from "./procedural-wall/export-solid-workers";

export async function buildOrderPairGeometry() {
    return Promise.all([buildFootSolidInWorker("left"), buildFootSolidInWorker("right")]);
}

export async function buildOrderPairStl() {
    return buildOrderPairGeometry();
}
