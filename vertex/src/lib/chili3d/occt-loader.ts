// Loads the Chili3D OpenCascade WASM module in the Vertex browser app.
// WASM binaries are copied to `public/chili-wasm/` by `npm run prepare:wasm`.

type WasmFactory = (options?: {
    locateFile?: (file: string) => string;
    wasmBinary?: BufferSource;
}) => Promise<unknown>;

const WASM_SCRIPT = "/chili-wasm/chili-wasm.js";

export async function initVertexOcct(): Promise<void> {
    const { default: MainModuleFactory } = (await import(WASM_SCRIPT)) as { default: WasmFactory };
    (globalThis as { wasm?: unknown }).wasm = await MainModuleFactory({
        locateFile: (file: string) => `/chili-wasm/${file}`,
    });
}
