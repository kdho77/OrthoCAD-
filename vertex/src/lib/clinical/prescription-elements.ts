import type { ParsedElement } from "@/types";

/**
 * Dancer's pads require deliberate medial-side placement, so AI Rx may suggest
 * them in its notes but must not insert them into the design automatically.
 */
export function prescriptionElementsForAutomaticPlacement(elements: ParsedElement[]): ParsedElement[] {
    return elements.filter((element) => element.kind !== "dancers_pad");
}
