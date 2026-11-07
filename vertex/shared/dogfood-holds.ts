// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Orders and designs on hold are refused before any read, export, or fixture use.

/** Identifiers the dogfood path must not open. Compared as a prefix, lowercased. */
export const DOGFOOD_HELD_ID_PREFIXES = [
    "ae30903d-d205-426b-a384-152810510248",
    "886ffef7",
    "11e0ec9b",
    "c4092f6e",
] as const;

export class DogfoodHoldError extends Error {
    constructor() {
        super("This order is on hold and is not available to the dogfood path.");
        this.name = "DogfoodHoldError";
    }
}

export function assertDogfoodNotHeld(value: string, prefixes: readonly string[] = DOGFOOD_HELD_ID_PREFIXES): void {
    const id = value.trim().toLowerCase();
    if (!id) return;
    for (const prefix of prefixes) {
        if (id === prefix || id.startsWith(prefix)) throw new DogfoodHoldError();
    }
}
