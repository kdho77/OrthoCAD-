/// <reference types="vite/client" />

declare module "/chili-wasm/chili-wasm.js" {
    const factory: (options?: {
        locateFile?: (file: string) => string;
        wasmBinary?: BufferSource;
    }) => Promise<unknown>;
    export default factory;
}
