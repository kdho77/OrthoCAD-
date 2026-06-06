// Minimal type shims so Vertex typechecks without compiling the full Chili3D monorepo.

declare module "@chili3d/core" {
    export type Result<T, E = string> = { isOk: true; value: T } | { isOk: false; error: E };

    export class XYZ {
        static readonly unitX: XYZ;
        static readonly unitZ: XYZ;
        readonly x: number;
        readonly y: number;
        readonly z: number;
        constructor(options: { x: number; y: number; z: number });
        add(right: { x: number; y: number; z: number } | XYZ): XYZ;
        multiply(scalar: number): XYZ;
    }

    export class Plane {
        constructor(options: { origin: XYZ; normal: XYZ; xvec: XYZ });
    }

    export const ShapeTypes: {
        solid: string;
        face: string;
        shell: string;
        compound: string;
    };

    export interface IShape {
        readonly shapeType: string;
        readonly mesh: {
            readonly faces?: { position: ArrayLike<number>; index: ArrayLike<number> };
        };
        isClosed(): boolean;
        findSubShapes(subshapeType: string): IShape[];
    }

    export interface IFace extends IShape {}
    export interface IShell extends IShape {}
    export interface ISolid extends IShape {}
    export interface IWire extends IShape {}

    export interface IShapeFactory {
        polygon(points: Array<{ x: number; y: number; z: number }>): Result<IWire>;
        loft(
            sections: IWire[],
            isSolid: boolean,
            isRuled: boolean,
            continuity: string,
        ): Result<IShape>;
        shell(faces: IFace[]): Result<IShell>;
        solid(shells: IShell[]): Result<ISolid>;
        box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid>;
        booleanFuse(a: IShape[], b: IShape[], simplify: boolean): Result<IShape>;
        booleanCut(a: IShape[], b: IShape[]): Result<IShape>;
        simplifyShape(shape: IShape, removeEdges: boolean, removeFaces: boolean, keep: IShape[]): Result<IShape>;
        sewing(a: IShape, b: IShape): Result<IShape>;
    }

    export function shapesToStl(shapes: IShape[], options?: { binary?: boolean }): Uint8Array;
}

declare module "@chili3d/wasm" {
    import type { IShapeFactory } from "@chili3d/core";

    export function initWasm(options?: { wasmBinary?: BufferSource }): Promise<void>;

    export class ShapeFactory implements IShapeFactory {
        polygon(points: Array<{ x: number; y: number; z: number }>): import("@chili3d/core").Result<
            import("@chili3d/core").IWire
        >;
        loft(
            sections: import("@chili3d/core").IWire[],
            isSolid: boolean,
            isRuled: boolean,
            continuity: string,
        ): import("@chili3d/core").Result<import("@chili3d/core").IShape>;
        shell(faces: import("@chili3d/core").IFace[]): import("@chili3d/core").Result<import("@chili3d/core").IShell>;
        solid(shells: import("@chili3d/core").IShell[]): import("@chili3d/core").Result<import("@chili3d/core").ISolid>;
        box(
            plane: import("@chili3d/core").Plane,
            dx: number,
            dy: number,
            dz: number,
        ): import("@chili3d/core").Result<import("@chili3d/core").ISolid>;
        booleanFuse(
            a: import("@chili3d/core").IShape[],
            b: import("@chili3d/core").IShape[],
            simplify: boolean,
        ): import("@chili3d/core").Result<import("@chili3d/core").IShape>;
        booleanCut(
            a: import("@chili3d/core").IShape[],
            b: import("@chili3d/core").IShape[],
        ): import("@chili3d/core").Result<import("@chili3d/core").IShape>;
        simplifyShape(
            shape: import("@chili3d/core").IShape,
            removeEdges: boolean,
            removeFaces: boolean,
            keep: import("@chili3d/core").IShape[],
        ): import("@chili3d/core").Result<import("@chili3d/core").IShape>;
        sewing(
            a: import("@chili3d/core").IShape,
            b: import("@chili3d/core").IShape,
        ): import("@chili3d/core").Result<import("@chili3d/core").IShape>;
    }
}
