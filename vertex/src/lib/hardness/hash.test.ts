// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { expect, test } from "@rstest/core";
import { canonicalizeJson, sha256Utf8 } from "./hash";

test("cleared optional fields produce valid deterministic saved-design JSON", () => {
    const a = { hardnessClass: "Soft", overrides: undefined, nested: { z: 2, optional: undefined, a: 1 } };
    const b = { nested: { a: 1, z: 2 }, hardnessClass: "Soft" };
    expect(JSON.parse(canonicalizeJson(a))).toEqual(b);
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(sha256Utf8(canonicalizeJson(a))).toBe(sha256Utf8(canonicalizeJson(b)));
    expect(canonicalizeJson([1, undefined, 3])).toBe("[1,null,3]");
});
