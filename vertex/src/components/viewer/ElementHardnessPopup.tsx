// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { Html } from "@react-three/drei";
import type { ComponentProps } from "react";
import { ElementHardnessSelector } from "@/features/elements/ElementHardnessSelector";

const popupPosition: NonNullable<ComponentProps<typeof Html>["calculatePosition"]> = (
    object,
    camera,
    size,
) => {
    const point = object.position.clone().setFromMatrixPosition(object.matrixWorld).project(camera);
    const x = (point.x * 0.5 + 0.5) * size.width + 14;
    const y = (-point.y * 0.5 + 0.5) * size.height - 30;
    return [Math.max(8, Math.min(size.width - 208, x)), Math.max(8, Math.min(size.height - 304, y))];
};

export function ElementHardnessPopup({
    elementId,
    position,
}: {
    elementId: string;
    position: [number, number, number];
}) {
    return (
        <Html position={position} calculatePosition={popupPosition} zIndexRange={[50, 40]}>
            <ElementHardnessSelector elementId={elementId} />
        </Html>
    );
}
