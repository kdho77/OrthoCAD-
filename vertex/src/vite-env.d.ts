/// <reference types="vite/client" />

declare const __IS_PRODUCTION__: boolean;
declare const __APP_VERSION__: string;
declare const __DOCUMENT_VERSION__: string;

declare module "/chili-wasm/chili-wasm.js" {
    const factory: (options?: {
        locateFile?: (file: string) => string;
        wasmBinary?: BufferSource;
    }) => Promise<unknown>;
    export default factory;
}
