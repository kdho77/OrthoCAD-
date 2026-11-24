import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";

self.onmessage = async (event: MessageEvent) => {
    const preview = await reconstructProceduralPreview(event.data.geo, event.data.options);
    self.postMessage(preview);
};
